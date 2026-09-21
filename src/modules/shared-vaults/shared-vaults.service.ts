import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as argon2 from 'argon2';
import { and, asc, count, desc, eq, inArray, lte } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  familyMembers,
  sharedVaultDeletionRequests,
  sharedVaultDeletionVotes,
  sharedVaultItems,
  sharedVaultMembers,
  sharedVaults,
  users,
  type SharedVaultDeletionRequestRow,
  type SharedVaultItemRow,
  type SharedVaultMemberRow,
  type SharedVaultRow,
} from '../../database/schema';
import { NotificationService } from '../../shared/services/notification.service';
import { StorageKeys } from '../../shared/services/storage-keys.util';
import { StorageService } from '../../shared/services/storage.service';
import { resolveStoredImageUrl } from '../../shared/utils/cover-url.util';
import { isActiveFamilyMember } from '../../shared/utils/family-membership.util';
import { sessionCutoff } from '../../shared/utils/session-cutoff.util';
import { assertStorageQuota } from '../../shared/utils/storage-quota.util';
import { assertValidMediaUpload } from '../media/media-upload-policy';
import type { RequestUploadUrlResult } from '../media/media.service';
import {
  DELETION_REQUEST_TTL_MS,
  MAX_SHARED_VAULT_MEMBERS,
  UNDO_WINDOW_MS,
  canDeleteItemAlone,
  deletionOutcome,
  requiredApprovers,
  type DeletionOutcome,
} from './shared-vault-policy';
import type {
  AcceptSharedVaultInput,
  ChangeSharedVaultPasscodeInput,
  CreateSharedVaultInput,
  CreateSharedVaultItemInput,
  DeletionRequest,
  DeletionResult,
  InviteSharedVaultMembersInput,
  RecoverSharedVaultInput,
  SharedVaultItem,
  SharedVaultMember,
  SharedVaultSession,
  SharedVaultSummary,
  UnlockSharedVaultInput,
} from './validations/shared-vault.schema';

/** A member row with what the screens need to draw them. */
type MemberView = SharedVaultMember & {
  vaultId: string;
  invitedBy: string | null;
};

/**
 * Shared Vaults: a private album for a few chosen family members, each with
 * their own passcode, where nothing is deleted unless everyone agrees.
 *
 * Access mirrors the personal Vault exactly — a normal signed-in session
 * gets you the list (names and members, never contents), and everything
 * inside needs a vault-scoped token from `unlock` (SharedVaultAccessGuard).
 * A token for one shared vault opens that vault and no other.
 *
 * "Active member" throughout means an accepted member who is *still in the
 * vault's family*: someone removed from the family loses the vault with it,
 * and stops counting as a required approver the same moment.
 */
@Injectable()
export class SharedVaultsService {
  private readonly logger = new Logger(SharedVaultsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly jwtService: JwtService,
    private readonly storageService: StorageService,
    private readonly notificationService: NotificationService,
  ) {}

  // ------------------------------------------------------------ list

  async list(userId: string): Promise<SharedVaultSummary[]> {
    const mine = await this.db.query.sharedVaultMembers.findMany({
      where: eq(sharedVaultMembers.userId, userId),
    });
    if (mine.length === 0) return [];

    const vaultRows = await this.db.query.sharedVaults.findMany({
      where: inArray(
        sharedVaults.id,
        mine.map((row) => row.vaultId),
      ),
      orderBy: desc(sharedVaults.createdAt),
    });
    // Out of the family means out of its vaults — they don't even list.
    const visible: SharedVaultRow[] = [];
    for (const vault of vaultRows) {
      if (await isActiveFamilyMember(this.db, userId, vault.familyId)) {
        visible.push(vault);
      }
    }
    if (visible.length === 0) return [];
    const vaultIds = visible.map((vault) => vault.id);

    await this.expireStale(vaultIds);

    const [membersByVault, itemCounts, pending] = await Promise.all([
      this.loadMembers(vaultIds),
      this.db
        .select({ vaultId: sharedVaultItems.vaultId, value: count() })
        .from(sharedVaultItems)
        .where(inArray(sharedVaultItems.vaultId, vaultIds))
        .groupBy(sharedVaultItems.vaultId),
      this.db.query.sharedVaultDeletionRequests.findMany({
        where: and(
          inArray(sharedVaultDeletionRequests.vaultId, vaultIds),
          eq(sharedVaultDeletionRequests.status, 'pending'),
        ),
      }),
    ]);
    const myVotes = pending.length
      ? await this.db.query.sharedVaultDeletionVotes.findMany({
          where: and(
            eq(sharedVaultDeletionVotes.userId, userId),
            inArray(
              sharedVaultDeletionVotes.requestId,
              pending.map((request) => request.id),
            ),
          ),
        })
      : [];
    const votedOn = new Set(myVotes.map((vote) => vote.requestId));
    const countByVault = new Map(
      itemCounts.map((row) => [row.vaultId, Number(row.value)]),
    );

    return visible.map((vault) => {
      const members = membersByVault.get(vault.id) ?? [];
      const me = members.find((member) => member.userId === userId);
      const inviter = me?.invitedBy
        ? members.find((member) => member.userId === me.invitedBy)
        : undefined;
      const awaitingMyVote =
        me?.status === 'active'
          ? pending.filter(
              (request) =>
                request.vaultId === vault.id &&
                request.requestedBy !== userId &&
                !votedOn.has(request.id),
            ).length
          : 0;

      return {
        id: vault.id,
        familyId: vault.familyId,
        name: vault.name,
        myRole: me?.role ?? 'member',
        myStatus: me?.status ?? 'invited',
        invitedByName: inviter?.name ?? null,
        members: members.map(toMemberDto),
        itemCount: countByVault.get(vault.id) ?? 0,
        awaitingMyVote,
        createdAt: vault.createdAt.toISOString(),
      };
    });
  }

  async get(userId: string, vaultId: string): Promise<SharedVaultSummary> {
    await this.requireMember(userId, vaultId);
    const summary = (await this.list(userId)).find(
      (vault) => vault.id === vaultId,
    );
    if (!summary) throw new NotFoundException('Shared vault not found');
    return summary;
  }

  // ------------------------------------------------------------ membership

  async create(
    userId: string,
    input: CreateSharedVaultInput,
  ): Promise<{ vault: SharedVaultSummary; session: SharedVaultSession }> {
    if (!(await isActiveFamilyMember(this.db, userId, input.familyId))) {
      throw new NotFoundException('Family not found');
    }
    const inviteeIds = [...new Set(input.memberIds)].filter(
      (id) => id !== userId,
    );
    if (inviteeIds.length === 0) {
      throw new BadRequestException('Choose at least one person to share with');
    }
    await this.assertFamilyMembers(input.familyId, inviteeIds);
    await this.assertDistinctFromAccountPassword(userId, input.passcode);

    const passcodeHash = await argon2.hash(input.passcode);
    const now = new Date();

    const vault = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(sharedVaults)
        .values({ familyId: input.familyId, name: input.name, createdBy: userId })
        .returning();
      await tx.insert(sharedVaultMembers).values([
        {
          vaultId: created.id,
          userId,
          role: 'owner' as const,
          status: 'active' as const,
          passcodeHash,
          joinedAt: now,
        },
        ...inviteeIds.map((inviteeId) => ({
          vaultId: created.id,
          userId: inviteeId,
          role: 'member' as const,
          status: 'invited' as const,
          invitedBy: userId,
        })),
      ]);
      return created;
    });

    void this.announceInvite(userId, vault, inviteeIds);

    return {
      vault: await this.get(userId, vault.id),
      session: await this.issueSession(userId, vault.id),
    };
  }

  /** Adding someone opens everything inside to them, so it sits behind the vault token. */
  async invite(
    userId: string,
    vaultId: string,
    input: InviteSharedVaultMembersInput,
  ): Promise<SharedVaultSummary> {
    const { vault } = await this.requireActiveMember(userId, vaultId);
    const existing = await this.db.query.sharedVaultMembers.findMany({
      where: eq(sharedVaultMembers.vaultId, vaultId),
    });
    const existingIds = new Set(existing.map((row) => row.userId));
    const newIds = [...new Set(input.memberIds)].filter(
      (id) => !existingIds.has(id),
    );
    if (newIds.length === 0) return this.get(userId, vaultId);
    if (existing.length + newIds.length > MAX_SHARED_VAULT_MEMBERS) {
      throw new BadRequestException(
        `A shared vault can have up to ${MAX_SHARED_VAULT_MEMBERS} people.`,
      );
    }
    await this.assertFamilyMembers(vault.familyId, newIds);

    await this.db.insert(sharedVaultMembers).values(
      newIds.map((inviteeId) => ({
        vaultId,
        userId: inviteeId,
        role: 'member' as const,
        status: 'invited' as const,
        invitedBy: userId,
      })),
    );
    void this.announceInvite(userId, vault, newIds);
    return this.get(userId, vaultId);
  }

  async accept(
    userId: string,
    vaultId: string,
    input: AcceptSharedVaultInput,
  ): Promise<SharedVaultSession> {
    const { vault, member } = await this.requireMember(userId, vaultId);
    if (member.status === 'active') {
      throw new ConflictException("You're already in this shared vault.");
    }
    if (!(await isActiveFamilyMember(this.db, userId, vault.familyId))) {
      throw new NotFoundException('Shared vault not found');
    }
    await this.assertDistinctFromAccountPassword(userId, input.passcode);

    await this.db
      .update(sharedVaultMembers)
      .set({
        status: 'active',
        passcodeHash: await argon2.hash(input.passcode),
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sharedVaultMembers.id, member.id));

    return this.issueSession(userId, vaultId);
  }

  async decline(userId: string, vaultId: string): Promise<void> {
    const { member } = await this.requireMember(userId, vaultId);
    if (member.status === 'active') {
      throw new BadRequestException('Leave the vault instead.');
    }
    await this.db
      .delete(sharedVaultMembers)
      .where(eq(sharedVaultMembers.id, member.id));
  }

  /**
   * Leaving never takes anything with it — what you added stays for everyone
   * else. The last person out closes the vault for good, since nobody would
   * be left who could open it.
   */
  async leave(userId: string, vaultId: string): Promise<void> {
    const { vault, member } = await this.requireMember(userId, vaultId);
    if (member.status === 'invited') {
      await this.decline(userId, vaultId);
      return;
    }

    await this.db
      .delete(sharedVaultMembers)
      .where(eq(sharedVaultMembers.id, member.id));
    // Their open requests go with them — nobody is left to see them through.
    await this.db
      .update(sharedVaultDeletionRequests)
      .set({ status: 'cancelled', resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(sharedVaultDeletionRequests.vaultId, vaultId),
          eq(sharedVaultDeletionRequests.requestedBy, userId),
          eq(sharedVaultDeletionRequests.status, 'pending'),
        ),
      );

    const remaining = await this.activeMembers(vault);
    if (remaining.length === 0) {
      await this.deleteVaultEntirely(vaultId);
      return;
    }
    if (member.role === 'owner' && !remaining.some((row) => row.role === 'owner')) {
      // Longest-standing member inherits it — the fairest choice nobody has to make.
      const [heir] = [...remaining].sort(
        (a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0),
      );
      await this.db
        .update(sharedVaultMembers)
        .set({ role: 'owner', updatedAt: new Date() })
        .where(eq(sharedVaultMembers.id, heir.id));
    }
    // One fewer approver can be all a pending request was waiting for.
    await this.resolvePending(vault);
  }

  async rename(
    userId: string,
    vaultId: string,
    name: string,
  ): Promise<SharedVaultSummary> {
    await this.requireActiveMember(userId, vaultId);
    await this.db
      .update(sharedVaults)
      .set({ name, updatedAt: new Date() })
      .where(eq(sharedVaults.id, vaultId));
    return this.get(userId, vaultId);
  }

  // ------------------------------------------------------------ passcodes

  /**
   * Same contract as the personal Vault's unlock: every failure has the same
   * shape — a decrementing counter, then a short lockout — and the lockout is
   * this member's alone. One person's typos never lock anyone else out.
   */
  async unlock(
    userId: string,
    vaultId: string,
    input: UnlockSharedVaultInput,
  ): Promise<SharedVaultSession> {
    const { member } = await this.requireActiveMember(userId, vaultId);
    await this.verifyPasscode(member, input.passcode);
    return this.issueSession(userId, vaultId);
  }

  async changePasscode(
    userId: string,
    vaultId: string,
    input: ChangeSharedVaultPasscodeInput,
  ): Promise<SharedVaultSession> {
    const { member } = await this.requireActiveMember(userId, vaultId);
    await this.verifyPasscode(member, input.currentPasscode);
    await this.assertDistinctFromAccountPassword(userId, input.newPasscode);
    await this.replacePasscode(member.id, input.newPasscode);
    return this.issueSession(userId, vaultId);
  }

  /** Forgotten passcode: re-proving the account is a strictly stronger check. */
  async recover(
    userId: string,
    vaultId: string,
    input: RecoverSharedVaultInput,
  ): Promise<SharedVaultSession> {
    const { member } = await this.requireActiveMember(userId, vaultId);
    const user = await this.requireUser(userId);
    if (!(await argon2.verify(user.passwordHash, input.accountPassword))) {
      throw new UnauthorizedException('Incorrect account password');
    }
    await this.assertDistinctFromAccountPassword(userId, input.newPasscode);
    await this.replacePasscode(member.id, input.newPasscode);
    return this.issueSession(userId, vaultId);
  }

  // ------------------------------------------------------------ items

  async listItems(userId: string, vaultId: string): Promise<SharedVaultItem[]> {
    const { vault } = await this.requireActiveMember(userId, vaultId);
    await this.expireStale([vaultId]);

    const [rows, requests] = await Promise.all([
      this.db.query.sharedVaultItems.findMany({
        where: eq(sharedVaultItems.vaultId, vaultId),
        orderBy: desc(sharedVaultItems.createdAt),
      }),
      this.pendingRequestDtos(userId, vault),
    ]);
    const byItem = new Map(
      requests
        .filter((request) => request.itemId)
        .map((request) => [request.itemId!, request]),
    );
    return Promise.all(
      rows.map((row) => this.toItemDto(row, byItem.get(row.id) ?? null)),
    );
  }

  async requestUploadUrl(
    userId: string,
    vaultId: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<RequestUploadUrlResult> {
    await this.requireActiveMember(userId, vaultId);
    const extension = assertValidMediaUpload(contentType, sizeBytes);
    await assertStorageQuota(this.db, userId, sizeBytes);
    const key = StorageKeys.sharedVaultItem({ vaultId, extension });
    const uploadUrl = await this.storageService.generatePresignedUploadUrl(
      key,
      contentType,
      300,
    );
    return { key, uploadUrl, expiresInSeconds: 300 };
  }

  async createItem(
    userId: string,
    vaultId: string,
    input: CreateSharedVaultItemInput,
  ): Promise<SharedVaultItem> {
    await this.requireActiveMember(userId, vaultId);
    // Only keys minted for *this* vault — otherwise registering someone
    // else's object key would pull it into a vault it was never uploaded to.
    if (!input.key.startsWith(StorageKeys.sharedVaultPrefix(vaultId))) {
      throw new BadRequestException('That upload belongs somewhere else.');
    }
    const [created] = await this.db
      .insert(sharedVaultItems)
      .values({
        vaultId,
        uploaderId: userId,
        type: input.type,
        storageKey: input.key,
        caption: input.caption,
        sizeBytes: input.sizeBytes,
      })
      .returning();
    return this.toItemDto(created, null);
  }

  /** Deletes at once when the rules allow one person to; otherwise asks everyone. */
  async deleteItem(
    userId: string,
    vaultId: string,
    itemId: string,
  ): Promise<DeletionResult> {
    const { vault } = await this.requireActiveMember(userId, vaultId);
    const item = await this.db.query.sharedVaultItems.findFirst({
      where: and(
        eq(sharedVaultItems.id, itemId),
        eq(sharedVaultItems.vaultId, vaultId),
      ),
    });
    if (!item) throw new NotFoundException('Not found in this vault');

    const active = await this.activeMembers(vault);
    if (
      canDeleteItemAlone({
        userId,
        uploaderId: item.uploaderId,
        uploadedAt: item.createdAt,
        activeMemberIds: active.map((row) => row.userId),
      })
    ) {
      await this.hardDeleteItem(item);
      return { deleted: true, request: null };
    }

    return this.openRequest(userId, vault, itemId);
  }

  /** The whole vault: the same mutual rule, one level up. */
  async requestVaultDeletion(
    userId: string,
    vaultId: string,
  ): Promise<DeletionResult> {
    const { vault } = await this.requireActiveMember(userId, vaultId);
    const active = await this.activeMembers(vault);
    if (requiredApprovers(active.map((row) => row.userId), userId).length === 0) {
      await this.deleteVaultEntirely(vaultId);
      return { deleted: true, request: null };
    }
    return this.openRequest(userId, vault, null);
  }

  // ------------------------------------------------------------ requests

  async listRequests(userId: string, vaultId: string): Promise<DeletionRequest[]> {
    const { vault } = await this.requireActiveMember(userId, vaultId);
    await this.expireStale([vaultId]);
    return this.pendingRequestDtos(userId, vault);
  }

  async vote(
    userId: string,
    vaultId: string,
    requestId: string,
    approve: boolean,
  ): Promise<DeletionResult> {
    const { vault } = await this.requireActiveMember(userId, vaultId);
    await this.expireStale([vaultId]);
    const request = await this.requirePendingRequest(vaultId, requestId);
    if (request.requestedBy === userId) {
      throw new BadRequestException("You can't answer your own request.");
    }

    await this.db
      .insert(sharedVaultDeletionVotes)
      .values({ requestId, userId, approve })
      .onConflictDoUpdate({
        target: [sharedVaultDeletionVotes.requestId, sharedVaultDeletionVotes.userId],
        set: { approve, createdAt: new Date() },
      });

    const settled = await this.settleIfDecided(vault, request);
    if (settled === 'approved') return { deleted: true, request: null };
    const [dto] = (await this.pendingRequestDtos(userId, vault)).filter(
      (candidate) => candidate.id === requestId,
    );
    return { deleted: false, request: dto ?? null };
  }

  async cancelRequest(userId: string, vaultId: string, requestId: string): Promise<void> {
    await this.requireActiveMember(userId, vaultId);
    const request = await this.requirePendingRequest(vaultId, requestId);
    if (request.requestedBy !== userId) {
      throw new ForbiddenException('Only the person who asked can withdraw it.');
    }
    await this.db
      .update(sharedVaultDeletionRequests)
      .set({ status: 'cancelled', resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(sharedVaultDeletionRequests.id, requestId));
  }

  /**
   * Lapses unanswered requests even when nobody opens the vault, so the
   * person who asked hears "it was kept" on the day, not whenever someone
   * next happens to look.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireAllStale(): Promise<void> {
    try {
      await this.expireStale();
    } catch (error) {
      this.logger.error(`Failed to expire shared vault requests: ${error}`);
    }
  }

  // ------------------------------------------------------------ internals

  private async openRequest(
    userId: string,
    vault: SharedVaultRow,
    itemId: string | null,
  ): Promise<DeletionResult> {
    // Asking twice doesn't open two requests — the first one is still live.
    const existing = (await this.pendingRequestDtos(userId, vault)).find(
      (request) => request.itemId === itemId,
    );
    if (existing) return { deleted: false, request: existing };

    const [created] = await this.db
      .insert(sharedVaultDeletionRequests)
      .values({
        vaultId: vault.id,
        itemId,
        requestedBy: userId,
        expiresAt: new Date(Date.now() + DELETION_REQUEST_TTL_MS),
      })
      .returning();

    const active = await this.activeMembers(vault);
    const actor = await this.requireUser(userId);
    void this.notificationService.pushSharedVaultDeletionRequest({
      recipientIds: requiredApprovers(active.map((row) => row.userId), userId),
      actorName: actor.name,
      vaultName: vault.name,
      vaultId: vault.id,
      wholeVault: itemId === null,
    });

    const [dto] = (await this.pendingRequestDtos(userId, vault)).filter(
      (request) => request.id === created.id,
    );
    return { deleted: false, request: dto ?? null };
  }

  /** Applies whatever the votes now add up to. Returns the outcome. */
  private async settleIfDecided(
    vault: SharedVaultRow,
    request: SharedVaultDeletionRequestRow,
  ): Promise<DeletionOutcome> {
    const [active, votes] = await Promise.all([
      this.activeMembers(vault),
      this.db.query.sharedVaultDeletionVotes.findMany({
        where: eq(sharedVaultDeletionVotes.requestId, request.id),
      }),
    ]);
    const outcome = deletionOutcome(
      active.map((row) => row.userId),
      request.requestedBy,
      votes,
    );
    if (outcome === 'pending') return outcome;

    await this.db
      .update(sharedVaultDeletionRequests)
      .set({ status: outcome, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(sharedVaultDeletionRequests.id, request.id));

    const wholeVault = request.itemId === null;
    if (outcome === 'approved') {
      if (wholeVault) {
        await this.deleteVaultEntirely(vault.id);
      } else {
        const item = await this.db.query.sharedVaultItems.findFirst({
          where: eq(sharedVaultItems.id, request.itemId!),
        });
        if (item) await this.hardDeleteItem(item);
      }
    }

    void this.notificationService.pushSharedVaultDeletionResult({
      recipientId: request.requestedBy,
      vaultName: vault.name,
      vaultId: vault.id,
      outcome,
      wholeVault,
    });
    return outcome;
  }

  /** Re-runs every pending request after membership changed. */
  private async resolvePending(vault: SharedVaultRow): Promise<void> {
    const pending = await this.db.query.sharedVaultDeletionRequests.findMany({
      where: and(
        eq(sharedVaultDeletionRequests.vaultId, vault.id),
        eq(sharedVaultDeletionRequests.status, 'pending'),
      ),
      orderBy: asc(sharedVaultDeletionRequests.createdAt),
    });
    for (const request of pending) {
      const outcome = await this.settleIfDecided(vault, request);
      // Approving a whole-vault deletion took everything else with it.
      if (outcome === 'approved' && request.itemId === null) return;
    }
  }

  /** Marks lapsed requests expired (optionally just for some vaults) and tells whoever asked. */
  private async expireStale(vaultIds?: string[]): Promise<void> {
    if (vaultIds && vaultIds.length === 0) return;
    const now = new Date();
    const expired = await this.db
      .update(sharedVaultDeletionRequests)
      .set({ status: 'expired', resolvedAt: now, updatedAt: now })
      .where(
        and(
          eq(sharedVaultDeletionRequests.status, 'pending'),
          lte(sharedVaultDeletionRequests.expiresAt, now),
          vaultIds ? inArray(sharedVaultDeletionRequests.vaultId, vaultIds) : undefined,
        ),
      )
      .returning();
    if (expired.length === 0) return;

    const vaults = await this.db.query.sharedVaults.findMany({
      where: inArray(
        sharedVaults.id,
        [...new Set(expired.map((request) => request.vaultId))],
      ),
    });
    const nameOf = new Map(vaults.map((vault) => [vault.id, vault.name]));
    for (const request of expired) {
      void this.notificationService.pushSharedVaultDeletionResult({
        recipientId: request.requestedBy,
        vaultName: nameOf.get(request.vaultId) ?? 'Shared vault',
        vaultId: request.vaultId,
        outcome: 'expired',
        wholeVault: request.itemId === null,
      });
    }
  }

  private async pendingRequestDtos(
    viewerId: string,
    vault: SharedVaultRow,
  ): Promise<DeletionRequest[]> {
    const requests = await this.db.query.sharedVaultDeletionRequests.findMany({
      where: and(
        eq(sharedVaultDeletionRequests.vaultId, vault.id),
        eq(sharedVaultDeletionRequests.status, 'pending'),
      ),
      orderBy: desc(sharedVaultDeletionRequests.createdAt),
    });
    if (requests.length === 0) return [];

    const [active, votes, membersByVault] = await Promise.all([
      this.activeMembers(vault),
      this.db.query.sharedVaultDeletionVotes.findMany({
        where: inArray(
          sharedVaultDeletionVotes.requestId,
          requests.map((request) => request.id),
        ),
      }),
      this.loadMembers([vault.id]),
    ]);
    const activeIds = active.map((row) => row.userId);
    const nameOf = new Map(
      (membersByVault.get(vault.id) ?? []).map((member) => [member.userId, member.name]),
    );

    return requests.map((request) => {
      const approverIds = requiredApprovers(activeIds, request.requestedBy);
      const mine = votes.filter((vote) => vote.requestId === request.id);
      const viewerVote = mine.find((vote) => vote.userId === viewerId);
      return {
        id: request.id,
        itemId: request.itemId,
        requestedBy: request.requestedBy,
        requestedByName: nameOf.get(request.requestedBy) ?? 'Someone',
        status: request.status,
        approverIds,
        approvedBy: mine
          .filter((vote) => vote.approve && approverIds.includes(vote.userId))
          .map((vote) => vote.userId),
        myVote: viewerVote ? (viewerVote.approve ? 'approve' : 'decline') : null,
        expiresAt: request.expiresAt.toISOString(),
        createdAt: request.createdAt.toISOString(),
      };
    });
  }

  private async requirePendingRequest(
    vaultId: string,
    requestId: string,
  ): Promise<SharedVaultDeletionRequestRow> {
    const request = await this.db.query.sharedVaultDeletionRequests.findFirst({
      where: and(
        eq(sharedVaultDeletionRequests.id, requestId),
        eq(sharedVaultDeletionRequests.vaultId, vaultId),
      ),
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'pending') {
      throw new ConflictException('This request has already been settled.');
    }
    return request;
  }

  private async hardDeleteItem(item: SharedVaultItemRow): Promise<void> {
    await this.db.delete(sharedVaultItems).where(eq(sharedVaultItems.id, item.id));
    try {
      await this.storageService.deleteObject(item.storageKey);
    } catch {
      // Best-effort — an orphaned object is cheap, a stuck delete isn't.
    }
  }

  private async deleteVaultEntirely(vaultId: string): Promise<void> {
    const items = await this.db.query.sharedVaultItems.findMany({
      where: eq(sharedVaultItems.vaultId, vaultId),
    });
    // Members, items, requests and votes all cascade from the vault row.
    await this.db.delete(sharedVaults).where(eq(sharedVaults.id, vaultId));
    await Promise.all(
      items.map((item) =>
        this.storageService.deleteObject(item.storageKey).catch(() => undefined),
      ),
    );
  }

  /** Accepted members who are still in the vault's family. */
  private async activeMembers(vault: SharedVaultRow): Promise<SharedVaultMemberRow[]> {
    const rows = await this.db
      .select({ member: sharedVaultMembers })
      .from(sharedVaultMembers)
      .innerJoin(
        familyMembers,
        and(
          eq(familyMembers.userId, sharedVaultMembers.userId),
          eq(familyMembers.familyId, vault.familyId),
        ),
      )
      .where(
        and(
          eq(sharedVaultMembers.vaultId, vault.id),
          eq(sharedVaultMembers.status, 'active'),
        ),
      );
    return rows.map((row) => row.member);
  }

  private async loadMembers(vaultIds: string[]): Promise<Map<string, MemberView[]>> {
    const rows = await this.db
      .select({
        vaultId: sharedVaultMembers.vaultId,
        userId: sharedVaultMembers.userId,
        role: sharedVaultMembers.role,
        status: sharedVaultMembers.status,
        invitedBy: sharedVaultMembers.invitedBy,
        name: users.name,
        nickname: familyMembers.nickname,
        avatarUrl: users.avatarUrl,
        avatarStorageKey: users.avatarStorageKey,
      })
      .from(sharedVaultMembers)
      .innerJoin(users, eq(users.id, sharedVaultMembers.userId))
      .innerJoin(sharedVaults, eq(sharedVaults.id, sharedVaultMembers.vaultId))
      .leftJoin(
        familyMembers,
        and(
          eq(familyMembers.userId, sharedVaultMembers.userId),
          eq(familyMembers.familyId, sharedVaults.familyId),
        ),
      )
      .where(inArray(sharedVaultMembers.vaultId, vaultIds))
      .orderBy(asc(sharedVaultMembers.createdAt));

    const avatars = await Promise.all(
      rows.map((row) =>
        resolveStoredImageUrl(this.storageService, row.avatarStorageKey, row.avatarUrl),
      ),
    );

    const byVault = new Map<string, MemberView[]>();
    rows.forEach((row, index) => {
      const view: MemberView = {
        vaultId: row.vaultId,
        userId: row.userId,
        // The name this family knows them by, same as everywhere else.
        name: row.nickname ?? row.name,
        avatarUrl: avatars[index] ?? null,
        role: row.role,
        status: row.status,
        invitedBy: row.invitedBy,
      };
      byVault.set(row.vaultId, [...(byVault.get(row.vaultId) ?? []), view]);
    });
    return byVault;
  }

  /** Any membership at all. Non-members get a 404, never a hint the vault exists. */
  private async requireMember(userId: string, vaultId: string) {
    const [vault, member] = await Promise.all([
      this.db.query.sharedVaults.findFirst({ where: eq(sharedVaults.id, vaultId) }),
      this.db.query.sharedVaultMembers.findFirst({
        where: and(
          eq(sharedVaultMembers.vaultId, vaultId),
          eq(sharedVaultMembers.userId, userId),
        ),
      }),
    ]);
    if (!vault || !member) throw new NotFoundException('Shared vault not found');
    return { vault, member };
  }

  private async requireActiveMember(userId: string, vaultId: string) {
    const found = await this.requireMember(userId, vaultId);
    if (!(await isActiveFamilyMember(this.db, userId, found.vault.familyId))) {
      throw new NotFoundException('Shared vault not found');
    }
    if (found.member.status !== 'active') {
      throw new ForbiddenException('Accept the invitation first.');
    }
    return found;
  }

  private async assertFamilyMembers(familyId: string, userIds: string[]): Promise<void> {
    for (const id of userIds) {
      if (!(await isActiveFamilyMember(this.db, id, familyId))) {
        throw new BadRequestException('You can only share with people in this family.');
      }
    }
  }

  private async verifyPasscode(
    member: SharedVaultMemberRow,
    passcode: string,
  ): Promise<void> {
    if (member.lockedUntil && member.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: 'VAULT_LOCKED',
        message: 'Too many attempts. Try again shortly.',
        details: { attemptsRemaining: 0, lockedUntil: member.lockedUntil.toISOString() },
      });
    }
    if (member.passcodeHash && (await argon2.verify(member.passcodeHash, passcode))) {
      if (member.failedAttempts > 0 || member.lockedUntil) {
        await this.db
          .update(sharedVaultMembers)
          .set({ failedAttempts: 0, lockedUntil: null })
          .where(eq(sharedVaultMembers.id, member.id));
      }
      return;
    }

    const attempts = member.failedAttempts + 1;
    const lockedOut = attempts >= env.VAULT_LOCKOUT_MAX_ATTEMPTS;
    const lockedUntil = lockedOut
      ? new Date(Date.now() + env.VAULT_LOCKOUT_MINUTES * 60_000)
      : null;
    await this.db
      .update(sharedVaultMembers)
      .set({
        failedAttempts: lockedOut ? 0 : attempts,
        lockedUntil: lockedUntil ?? member.lockedUntil,
      })
      .where(eq(sharedVaultMembers.id, member.id));

    // The same codes and shape as the personal Vault, so one lock screen
    // renders both.
    throw new UnauthorizedException({
      code: lockedOut ? 'VAULT_LOCKED' : 'VAULT_WRONG_PASSWORD',
      message: lockedOut ? 'Too many attempts. Try again shortly.' : 'Incorrect passcode',
      details: {
        attemptsRemaining: lockedOut ? 0 : env.VAULT_LOCKOUT_MAX_ATTEMPTS - attempts,
        lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
      },
    });
  }

  private async replacePasscode(memberId: string, passcode: string): Promise<void> {
    await this.db
      .update(sharedVaultMembers)
      .set({
        passcodeHash: await argon2.hash(passcode),
        // Whole seconds — see sessionCutoff.
        sessionsInvalidatedAt: sessionCutoff(),
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(sharedVaultMembers.id, memberId));
  }

  private async assertDistinctFromAccountPassword(
    userId: string,
    passcode: string,
  ): Promise<void> {
    const user = await this.requireUser(userId);
    if (await argon2.verify(user.passwordHash, passcode)) {
      throw new BadRequestException(
        'Your vault passcode must be different from your account sign-in password.',
      );
    }
  }

  private async issueSession(userId: string, vaultId: string): Promise<SharedVaultSession> {
    const expiresInSeconds = env.VAULT_SESSION_TTL_MINUTES * 60;
    const vaultToken = await this.jwtService.signAsync(
      { sub: userId, scope: 'shared-vault', vid: vaultId },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: expiresInSeconds },
    );
    return { vaultToken, expiresInSeconds };
  }

  private async announceInvite(
    actorId: string,
    vault: SharedVaultRow,
    recipientIds: string[],
  ): Promise<void> {
    try {
      const actor = await this.requireUser(actorId);
      await this.notificationService.pushSharedVaultInvite({
        recipientIds,
        actorName: actor.name,
        vaultName: vault.name,
        vaultId: vault.id,
      });
    } catch (error) {
      this.logger.error(`Failed to announce shared vault invite: ${error}`);
    }
  }

  private async requireUser(userId: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Always presigned and short-lived — no public path to vault content, ever. */
  private async toItemDto(
    row: SharedVaultItemRow,
    pendingDeletion: DeletionRequest | null,
  ): Promise<SharedVaultItem> {
    return {
      id: row.id,
      type: row.type,
      url: await this.storageService.generatePresignedDownloadUrl(row.storageKey),
      caption: row.caption,
      sizeBytes: row.sizeBytes,
      uploaderId: row.uploaderId,
      undoUntil: new Date(row.createdAt.getTime() + UNDO_WINDOW_MS).toISOString(),
      pendingDeletion,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function toMemberDto(member: MemberView): SharedVaultMember {
  return {
    userId: member.userId,
    name: member.name,
    avatarUrl: member.avatarUrl,
    role: member.role,
    status: member.status,
  };
}
