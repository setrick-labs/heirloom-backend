import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { journeys, milestones, users, vaultItems } from '../../database/schema';
import { StorageKeys } from '../../shared/services/storage-keys.util';
import { StorageService } from '../../shared/services/storage.service';
import { requireJourneyAccess } from '../../shared/utils/journey-access.util';
import { assertStorageQuota } from '../../shared/utils/storage-quota.util';
import { assertValidMediaUpload } from '../media/media-upload-policy';
import { MediaService, type RequestUploadUrlResult } from '../media/media.service';
import type { Media } from '../media/validations/media.schema';
import {
  CreateVaultItemInput,
  RecoverVaultInput,
  SetupVaultInput,
  UnlockVaultInput,
  VaultItem,
  VaultSession,
  VaultStatus,
} from './validations/vault.schema';

@Injectable()
export class VaultService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly jwtService: JwtService,
    private readonly storageService: StorageService,
    private readonly mediaService: MediaService,
  ) {}

  async status(userId: string): Promise<VaultStatus> {
    const user = await this.requireUser(userId);
    return { isSetUp: Boolean(user.vaultPasswordHash) };
  }

  /** Section 1: first-time setup. Section 1.2: must differ from the account password. */
  async setup(userId: string, input: SetupVaultInput): Promise<VaultSession> {
    const user = await this.requireUser(userId);
    if (user.vaultPasswordHash) {
      throw new ConflictException(
        'The Vault is already set up. Use unlock, or recover it if you forgot the password.',
      );
    }
    await this.assertDistinctFromAccountPassword(
      user.passwordHash,
      input.password,
    );

    const vaultPasswordHash = await argon2.hash(input.password);
    await this.db
      .update(users)
      .set({ vaultPasswordHash })
      .where(eq(users.id, userId));

    return this.issueVaultSession(userId);
  }

  /**
   * Screen 46: a wrong passcode must never reveal anything about what's
   * inside, so every failure returns the same shape — just a decrementing
   * attempts counter, then a short lockout. Deliberately tracked on its own
   * columns rather than the account's failedLoginAttempts/lockedUntil: a
   * fumbled vault passcode is not an account compromise signal and must not
   * lock someone out of Heirloom itself.
   */
  async unlock(userId: string, input: UnlockVaultInput): Promise<VaultSession> {
    const user = await this.requireUser(userId);
    if (!user.vaultPasswordHash) {
      throw new NotFoundException('Set up the Vault first.');
    }

    if (user.vaultLockedUntil && user.vaultLockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: 'VAULT_LOCKED',
        message: 'Too many attempts. Try again shortly.',
        details: {
          attemptsRemaining: 0,
          lockedUntil: user.vaultLockedUntil.toISOString(),
        },
      });
    }

    const matches = await argon2.verify(user.vaultPasswordHash, input.password);
    if (!matches) {
      throw await this.registerFailedUnlock(user);
    }

    // Clear the counter only when it's actually dirty, so a normal unlock
    // stays a pure read.
    if (user.vaultFailedAttempts > 0 || user.vaultLockedUntil) {
      await this.db
        .update(users)
        .set({ vaultFailedAttempts: 0, vaultLockedUntil: null })
        .where(eq(users.id, userId));
    }

    return this.issueVaultSession(userId);
  }

  /** Bumps the counter, locks out at the threshold, and builds the error the screen renders. */
  private async registerFailedUnlock(
    user: typeof users.$inferSelect,
  ): Promise<UnauthorizedException> {
    const attempts = user.vaultFailedAttempts + 1;
    const lockedOut = attempts >= env.VAULT_LOCKOUT_MAX_ATTEMPTS;
    const lockedUntil = lockedOut
      ? new Date(Date.now() + env.VAULT_LOCKOUT_MINUTES * 60_000)
      : null;

    await this.db
      .update(users)
      // Reset to 0 on lockout, same as the sign-in path: vaultLockedUntil
      // is what gates access from here, and leaving the counter at the
      // threshold would re-lock instantly on the first attempt afterward.
      .set({
        vaultFailedAttempts: lockedOut ? 0 : attempts,
        vaultLockedUntil: lockedUntil ?? user.vaultLockedUntil,
      })
      .where(eq(users.id, user.id));

    return new UnauthorizedException({
      code: lockedOut ? 'VAULT_LOCKED' : 'VAULT_WRONG_PASSWORD',
      message: lockedOut
        ? 'Too many attempts. Try again shortly.'
        : 'Incorrect passcode',
      details: {
        attemptsRemaining: lockedOut
          ? 0
          : env.VAULT_LOCKOUT_MAX_ATTEMPTS - attempts,
        lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
      },
    });
  }

  /**
   * Section 6: forgotten Vault password, recovered through account-level
   * re-authentication rather than a truly unrecoverable secret — a
   * deliberate security-vs-usability tradeoff, not an oversight.
   */
  async recover(
    userId: string,
    input: RecoverVaultInput,
  ): Promise<VaultSession> {
    const user = await this.requireUser(userId);
    const accountPasswordMatches = await argon2.verify(
      user.passwordHash,
      input.accountPassword,
    );
    if (!accountPasswordMatches) {
      throw new UnauthorizedException('Incorrect account password');
    }
    await this.assertDistinctFromAccountPassword(
      user.passwordHash,
      input.newVaultPassword,
    );

    const vaultPasswordHash = await argon2.hash(input.newVaultPassword);
    const now = new Date();
    await this.db
      .update(users)
      // Clears any active lockout too: recovery already proved account
      // ownership, which is a strictly stronger check than the passcode the
      // lockout was protecting — leaving it set would lock someone out of a
      // vault they just re-established control of.
      .set({
        vaultPasswordHash,
        vaultSessionsInvalidatedAt: now,
        vaultFailedAttempts: 0,
        vaultLockedUntil: null,
      })
      .where(eq(users.id, userId));

    return this.issueVaultSession(userId);
  }

  async requestUploadUrl(
    userId: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<RequestUploadUrlResult> {
    const extension = assertValidMediaUpload(contentType, sizeBytes);
    // The Vault is private, but it is not free: it draws on the same
    // per-person allowance as everything else the user owns.
    await assertStorageQuota(this.db, userId, sizeBytes);
    const key = StorageKeys.vaultItem({ userId, extension });
    const uploadUrl = await this.storageService.generatePresignedUploadUrl(
      key,
      contentType,
    );
    return { key, uploadUrl, expiresInSeconds: 300 };
  }

  async createItem(
    userId: string,
    input: CreateVaultItemInput,
  ): Promise<VaultItem> {
    const [created] = await this.db
      .insert(vaultItems)
      .values({
        ownerId: userId,
        type: input.type,
        storageKey: input.key,
        caption: input.caption,
        sizeBytes: input.sizeBytes,
      })
      .returning();
    return this.toDto(created);
  }

  /** Always scoped to the caller — there is no "list someone else's vault" code path at all, not even a check to bypass. */
  async listItems(userId: string): Promise<VaultItem[]> {
    const rows = await this.db.query.vaultItems.findMany({
      where: eq(vaultItems.ownerId, userId),
      orderBy: desc(vaultItems.createdAt),
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  /** Section 7: owner-only (trivially — always scoped to the caller), lightweight hard delete, no grace period. */
  async deleteItem(userId: string, id: string): Promise<void> {
    const row = await this.db.query.vaultItems.findFirst({
      where: eq(vaultItems.id, id),
    });
    if (!row || row.ownerId !== userId) {
      throw new NotFoundException('Vault item not found');
    }

    await this.db.delete(vaultItems).where(eq(vaultItems.id, id));
    try {
      await this.storageService.deleteObject(row.storageKey);
    } catch {
      // Best-effort — an orphaned R2 object is cheap, a stuck delete isn't.
    }
  }

  /**
   * Vault → Milestone: the mirror image of MediaService.moveToVault.
   *
   * The object is copied into the destination Milestone's key namespace —
   * `StorageKeys.journeyMedia`, not the Vault's own prefix — since the two
   * are deliberately separate conventions (vault-items.ts). Once the copy
   * exists there, the actual `media` row is created through
   * `MediaService.create()` rather than by hand here: that's the one place
   * a media row is ever written, and reusing it means this move announces
   * itself exactly like an ordinary upload ("Maya added a memory") instead
   * of arriving silently.
   */
  async moveToMilestone(
    userId: string,
    itemId: string,
    milestoneId: string,
  ): Promise<Media> {
    const item = await this.db.query.vaultItems.findFirst({
      where: eq(vaultItems.id, itemId),
    });
    if (!item || item.ownerId !== userId) {
      throw new NotFoundException('Vault item not found');
    }

    const milestone = await this.db.query.milestones.findFirst({
      where: and(eq(milestones.id, milestoneId), isNull(milestones.deletedAt)),
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    // Same gate as adding any other memory to an existing Milestone —
    // anyone with visibility into its journey, not just its creator.
    await requireJourneyAccess(this.db, userId, milestone.journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, milestone.journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Milestone not found');
    }

    const destinationKey = StorageKeys.journeyMedia({
      familyId: journey.familyId,
      journeyId: journey.id,
      milestoneId: milestone.id,
      extension: StorageKeys.extensionOf(item.storageKey),
    });
    await this.storageService.copyObject(item.storageKey, destinationKey);

    const created = await this.mediaService.create(userId, {
      familyId: journey.familyId,
      milestoneId: milestone.id,
      type: item.type,
      key: destinationKey,
      caption: item.caption,
      sizeBytes: item.sizeBytes,
    });

    await this.db.delete(vaultItems).where(eq(vaultItems.id, item.id));
    try {
      await this.storageService.deleteObject(item.storageKey);
    } catch {
      // Best-effort — an orphaned R2 object is cheap, a stuck move isn't.
    }

    return created;
  }

  private async assertDistinctFromAccountPassword(
    accountPasswordHash: string,
    candidateVaultPassword: string,
  ): Promise<void> {
    const sameAsAccountPassword = await argon2.verify(
      accountPasswordHash,
      candidateVaultPassword,
    );
    if (sameAsAccountPassword) {
      throw new BadRequestException(
        'Your Vault password must be different from your account sign-in password.',
      );
    }
  }

  private async issueVaultSession(userId: string): Promise<VaultSession> {
    const expiresInSeconds = env.VAULT_SESSION_TTL_MINUTES * 60;
    const vaultToken = await this.jwtService.signAsync(
      { sub: userId, scope: 'vault' },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: expiresInSeconds },
    );
    return { vaultToken, expiresInSeconds };
  }

  private async requireUser(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Vault spec Section 3/5: content here must never be reachable without a
   * per-request signature — always a short-lived presigned URL, no
   * unsigned/public serving path, ever.
   */
  private async resolveUrl(storageKey: string): Promise<string> {
    return this.storageService.generatePresignedDownloadUrl(storageKey);
  }

  private async toDto(row: typeof vaultItems.$inferSelect): Promise<VaultItem> {
    return {
      id: row.id,
      type: row.type,
      url: await this.resolveUrl(row.storageKey),
      caption: row.caption,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
