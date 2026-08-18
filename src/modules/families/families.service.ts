import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  aliases,
  familyInvites,
  familyMembers,
  families,
  users,
} from '../../database/schema';
import { StorageService } from '../../shared/services/storage.service';
import { generateNumericCode } from '../../shared/utils/auth-tokens.util';
import { resolveCoverImageUrl } from '../../shared/utils/cover-url.util';
import { resolveDisplayName } from '../../shared/utils/display-name.util';
import {
  getFamilyMembership,
  isActiveFamilyMember,
  isFamilyMember,
  resolveActiveFamilyId,
} from '../../shared/utils/family-membership.util';
import type { FamilyMemberView } from './validations/family-member.schema';
import {
  FamilyInvite,
  FamilyInvitePreview,
  JoinFamilyInput,
} from './validations/family-invite.schema';
import { CreateFamilyInput, Family } from './validations/family.schema';

const ADMIN_ROLES = new Set(['owner', 'admin']);
const INVITE_CODE_MAX_ATTEMPTS = 10;

@Injectable()
export class FamiliesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
  ) {}

  async create(ownerId: string, input: CreateFamilyInput): Promise<Family> {
    const family = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(families)
        .values({ name: input.name, description: input.description, ownerId })
        .returning();

      await tx.insert(familyMembers).values({
        familyId: created.id,
        userId: ownerId,
        role: 'owner',
      });

      // "Person lands inside this family's workspace" — make it active immediately.
      await tx
        .update(users)
        .set({ activeFamilyId: created.id })
        .where(eq(users.id, ownerId));

      return created;
    });

    return this.toDto(family, 1);
  }

  async listForUser(userId: string): Promise<Family[]> {
    const rows = await this.db
      .select({ family: families })
      .from(familyMembers)
      .innerJoin(families, eq(familyMembers.familyId, families.id))
      .where(and(eq(familyMembers.userId, userId), isNull(families.deletedAt)));

    // One grouped count for the whole list, not withMemberCount() per row
    // (was N+1). Same rule as journeys.listForFamily's aggregates and
    // MediaService.countCommentsFor: a list endpoint issues a fixed number
    // of queries regardless of how many rows it returns.
    const memberCounts = await this.countMembersFor(
      rows.map((row) => row.family.id),
    );
    return Promise.all(
      rows.map((row) =>
        this.toDto(row.family, memberCounts.get(row.family.id) ?? 0),
      ),
    );
  }

  async findById(id: string): Promise<Family> {
    const family = await this.db.query.families.findFirst({
      where: and(eq(families.id, id), isNull(families.deletedAt)),
    });
    if (!family) {
      throw new NotFoundException('Family not found');
    }
    return this.withMemberCount(family);
  }

  /** Section 3: roster, each name already resolved for this viewer (their alias, or the person's display name). */
  async getMembers(
    viewerId: string,
    familyId: string,
  ): Promise<FamilyMemberView[]> {
    await this.requireMember(viewerId, familyId);

    const rows = await this.db
      .select({
        userId: familyMembers.userId,
        role: familyMembers.role,
        joinedAt: familyMembers.joinedAt,
        nickname: familyMembers.nickname,
        displayName: users.name,
      })
      .from(familyMembers)
      .innerJoin(users, eq(familyMembers.userId, users.id))
      .where(eq(familyMembers.familyId, familyId));

    const aliasRows = await this.db.query.aliases.findMany({
      where: and(
        eq(aliases.familyId, familyId),
        eq(aliases.viewerUserId, viewerId),
      ),
    });
    const aliasByTarget = new Map(
      aliasRows.map((row) => [row.subjectUserId, row.nickname]),
    );

    return rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      joinedAt: row.joinedAt.toISOString(),
      ...resolveDisplayName({
        displayName: row.displayName,
        nickname: row.nickname,
        alias: aliasByTarget.get(row.userId),
      }),
    }));
  }

  /**
   * Screen 14 / Screen 34's own-row "Edit" — the name everyone in this
   * family sees for you. Self-service only: the viewer is always the
   * subject, so there's no target-user parameter to authorize.
   */
  async setOwnNickname(
    viewerId: string,
    familyId: string,
    nickname: string,
  ): Promise<void> {
    await this.requireMember(viewerId, familyId);

    await this.db
      .update(familyMembers)
      .set({ nickname })
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, viewerId),
        ),
      );
  }

  /** Section 2: private, per-viewer — upserts so re-setting an alias just updates it. */
  async setAlias(
    viewerId: string,
    familyId: string,
    targetUserId: string,
    nickname: string,
  ): Promise<void> {
    if (targetUserId === viewerId) {
      throw new ForbiddenException(
        'You cannot set an alias for yourself — edit your name instead.',
      );
    }
    await this.requireMember(viewerId, familyId);
    if (!(await isFamilyMember(this.db, targetUserId, familyId))) {
      throw new NotFoundException('That person is not a member of this family');
    }

    await this.db
      .insert(aliases)
      .values({
        familyId,
        subjectUserId: targetUserId,
        viewerUserId: viewerId,
        nickname,
      })
      .onConflictDoUpdate({
        target: [aliases.familyId, aliases.subjectUserId, aliases.viewerUserId],
        set: { nickname, updatedAt: new Date() },
      });
  }

  /** Reverts that person's display, for this viewer, back to their display name. Idempotent. */
  async clearAlias(
    viewerId: string,
    familyId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.db
      .delete(aliases)
      .where(
        and(
          eq(aliases.familyId, familyId),
          eq(aliases.subjectUserId, targetUserId),
          eq(aliases.viewerUserId, viewerId),
        ),
      );
  }

  /** Section 4: admin-only, revokes access immediately. Content stays, attributed to them. */
  async removeMember(
    adminId: string,
    familyId: string,
    targetUserId: string,
  ): Promise<void> {
    if (targetUserId === adminId) {
      throw new ForbiddenException('Use "leave family" to remove yourself');
    }
    await this.requireAdmin(adminId, familyId);
    if (!(await getFamilyMembership(this.db, targetUserId, familyId))) {
      throw new NotFoundException('That person is not a member of this family');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, familyId),
            eq(familyMembers.userId, targetUserId),
          ),
        );
      // Discard alias context tied to this membership, in both directions
      // (aliases they set for others, and aliases others set for them).
      await tx
        .delete(aliases)
        .where(
          and(
            eq(aliases.familyId, familyId),
            or(
              eq(aliases.subjectUserId, targetUserId),
              eq(aliases.viewerUserId, targetUserId),
            ),
          ),
        );
    });

    await this.healActiveFamilyId(targetUserId, familyId);
  }

  /** Section 5: additive — multiple admins can coexist, no distinction from the original creator. */
  async promoteMember(
    adminId: string,
    familyId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.requireAdmin(adminId, familyId);
    const membership = await getFamilyMembership(
      this.db,
      targetUserId,
      familyId,
    );
    if (!membership) {
      throw new NotFoundException('That person is not a member of this family');
    }
    if (ADMIN_ROLES.has(membership.role)) {
      return;
    }

    await this.db
      .update(familyMembers)
      .set({ role: 'admin' })
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, targetUserId),
        ),
      );
  }

  /**
   * Section 6: self-service departure. A lone remaining member leaving is
   * treated as deleting the family (nowhere for it to go); a lone admin
   * leaving a multi-member family is blocked until they promote someone else.
   */
  async leaveFamily(
    userId: string,
    familyId: string,
  ): Promise<{ familyDeleted: boolean }> {
    const membership = await getFamilyMembership(this.db, userId, familyId);
    if (!membership) {
      throw new NotFoundException('You are not a member of this family');
    }

    const [{ value: memberCount }] = await this.db
      .select({ value: count() })
      .from(familyMembers)
      .where(eq(familyMembers.familyId, familyId));

    if (memberCount === 1) {
      await this.softDelete(familyId);
      return { familyDeleted: true };
    }

    if (ADMIN_ROLES.has(membership.role)) {
      const [{ value: otherAdminCount }] = await this.db
        .select({ value: count() })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, familyId),
            ne(familyMembers.userId, userId),
            inArray(familyMembers.role, ['owner', 'admin']),
          ),
        );
      if (otherAdminCount === 0) {
        throw new ConflictException(
          'Promote another member to admin before leaving — a family always needs at least one admin.',
        );
      }
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, familyId),
            eq(familyMembers.userId, userId),
          ),
        );
      await tx
        .delete(aliases)
        .where(
          and(
            eq(aliases.familyId, familyId),
            or(
              eq(aliases.subjectUserId, userId),
              eq(aliases.viewerUserId, userId),
            ),
          ),
        );
    });

    await this.healActiveFamilyId(userId, familyId);
    return { familyDeleted: false };
  }

  /** Section 8: admin-only, deliberately just a name — no other family settings requested. */
  /**
   * Rename and/or set the cover photo (Screen 12). Both are admin-gated and
   * both arrive on the same PATCH, so they share one path rather than
   * splitting into two near-identical owner-checked updates.
   */
  async updateFamily(
    adminId: string,
    familyId: string,
    input: { name?: string; coverStorageKey?: string | null },
  ): Promise<Family> {
    await this.requireAdmin(adminId, familyId);
    const [updated] = await this.db
      .update(families)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.coverStorageKey !== undefined
          ? { coverStorageKey: input.coverStorageKey }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(families.id, familyId))
      .returning();
    if (!updated) {
      throw new NotFoundException('Family not found');
    }
    return this.withMemberCount(updated);
  }

  /**
   * Section 7: soft-delete with a grace period. `confirmName` is validated
   * server-side too — the "type the name to confirm" pattern is a UX gate,
   * not a security boundary, so it shouldn't be trustable from the client alone.
   */
  async initiateDelete(
    adminId: string,
    familyId: string,
    confirmName: string,
  ): Promise<Family> {
    await this.requireAdmin(adminId, familyId);
    const family = await this.db.query.families.findFirst({
      where: and(eq(families.id, familyId), isNull(families.deletedAt)),
    });
    if (!family) {
      throw new NotFoundException('Family not found');
    }
    if (confirmName !== family.name) {
      throw new BadRequestException(
        'Type the family name exactly to confirm deletion.',
      );
    }

    return this.softDelete(familyId);
  }

  /** Available only during the grace period — admin-only, bypasses the deleted-family filter deliberately. */
  async cancelDelete(adminId: string, familyId: string): Promise<Family> {
    const family = await this.db.query.families.findFirst({
      where: eq(families.id, familyId),
    });
    if (!family?.deletedAt) {
      throw new NotFoundException('This family is not pending deletion.');
    }

    const membership = await getFamilyMembership(this.db, adminId, familyId);
    if (!membership || !ADMIN_ROLES.has(membership.role)) {
      throw new ForbiddenException('Only a family admin can do that');
    }

    const graceDeadline = new Date(
      family.deletedAt.getTime() +
        env.FAMILY_DELETION_GRACE_PERIOD_DAYS * 86_400_000,
    );
    if (graceDeadline <= new Date()) {
      throw new ConflictException(
        'The recovery window for this family has passed.',
      );
    }

    const [updated] = await this.db
      .update(families)
      .set({ deletedAt: null })
      .where(eq(families.id, familyId))
      .returning();
    return this.withMemberCount(updated);
  }

  /**
   * Generates a fresh invite code/link for a family — admin/owner only.
   * Regenerating revokes whatever code was previously active, per spec.
   */
  async generateInvite(
    userId: string,
    familyId: string,
  ): Promise<FamilyInvite> {
    await this.requireAdmin(userId, familyId);

    const expiresAt = new Date(
      Date.now() + env.FAMILY_INVITE_TTL_DAYS * 86_400_000,
    );

    const invite = await this.db.transaction(async (tx) => {
      await tx
        .update(familyInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(familyInvites.familyId, familyId),
            isNull(familyInvites.revokedAt),
          ),
        );

      let code: string | undefined;
      for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS; attempt++) {
        const candidate = generateNumericCode(6);
        const existing = await tx.query.familyInvites.findFirst({
          where: eq(familyInvites.code, candidate),
        });
        if (!existing) {
          code = candidate;
          break;
        }
      }
      if (!code) {
        throw new ConflictException(
          'Could not generate a unique invite code — try again.',
        );
      }

      const [created] = await tx
        .insert(familyInvites)
        .values({ familyId, code, createdBy: userId, expiresAt })
        .returning();
      return created;
    });

    return this.toInviteDto(invite);
  }

  /** Preview before joining — name + member count only, never private content. */
  async previewInvite(
    userId: string,
    code: string,
  ): Promise<FamilyInvitePreview> {
    const invite = await this.findActiveInvite(code);
    const family = await this.findById(invite.familyId);
    const alreadyMember = Boolean(
      await getFamilyMembership(this.db, userId, invite.familyId),
    );

    return {
      familyId: family.id,
      familyName: family.name,
      memberCount: family.memberCount,
      alreadyMember,
    };
  }

  async joinViaInvite(userId: string, input: JoinFamilyInput): Promise<Family> {
    const invite = await this.findActiveInvite(input.code);

    const existingMembership = await getFamilyMembership(
      this.db,
      userId,
      invite.familyId,
    );
    if (!existingMembership) {
      await this.db.transaction(async (tx) => {
        await tx.insert(familyMembers).values({
          familyId: invite.familyId,
          userId,
          role: 'member',
        });
        await tx
          .update(users)
          .set({ activeFamilyId: invite.familyId })
          .where(eq(users.id, userId));
      });
    } else {
      // Idempotent: joining twice (or via two invite paths) just drops them
      // into the family, no error, no duplicate membership.
      await this.db
        .update(users)
        .set({ activeFamilyId: invite.familyId })
        .where(eq(users.id, userId));
    }

    return this.findById(invite.familyId);
  }

  private async softDelete(familyId: string): Promise<Family> {
    const [updated] = await this.db
      .update(families)
      .set({ deletedAt: new Date() })
      .where(eq(families.id, familyId))
      .returning();
    return this.withMemberCount(updated);
  }

  /** Fixes a stale activeFamilyId the moment membership to it is lost, rather than waiting for next sign-in. */
  private async healActiveFamilyId(
    userId: string,
    familyIdBeingLost: string,
  ): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (user?.activeFamilyId !== familyIdBeingLost) {
      return;
    }
    const nextActiveFamilyId = await resolveActiveFamilyId(
      this.db,
      userId,
      null,
    );
    await this.db
      .update(users)
      .set({ activeFamilyId: nextActiveFamilyId })
      .where(eq(users.id, userId));
  }

  /** Uses isActiveFamilyMember, not plain isFamilyMember — a soft-deleted family is inaccessible even to its members. */
  private async requireMember(userId: string, familyId: string): Promise<void> {
    if (!(await isActiveFamilyMember(this.db, userId, familyId))) {
      throw new ForbiddenException('You are not a member of this family');
    }
  }

  private async requireAdmin(userId: string, familyId: string): Promise<void> {
    const membership = await getFamilyMembership(this.db, userId, familyId);
    if (
      !membership ||
      !ADMIN_ROLES.has(membership.role) ||
      !(await isActiveFamilyMember(this.db, userId, familyId))
    ) {
      throw new ForbiddenException('Only a family admin can do that');
    }
  }

  /**
   * Resolves a code to a live invite. Not-found and expired/revoked get the
   * identical error — a code that "almost matched" shouldn't be
   * distinguishable from one that's simply expired (avoids code-guessing feedback).
   */
  private async findActiveInvite(code: string) {
    const invite = await this.db.query.familyInvites.findFirst({
      where: and(
        eq(familyInvites.code, code),
        isNull(familyInvites.revokedAt),
        gt(familyInvites.expiresAt, new Date()),
      ),
    });
    if (!invite) {
      throw new NotFoundException(
        'This invite code is invalid or has expired. Ask the admin for a new one.',
      );
    }
    return invite;
  }

  private toInviteDto(row: typeof familyInvites.$inferSelect): FamilyInvite {
    return {
      code: row.code,
      link: env.INVITE_LINK_BASE_URL
        ? `${env.INVITE_LINK_BASE_URL}?code=${row.code}`
        : null,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /** Single-row callers only — list paths must use countMembersFor instead. */
  private async withMemberCount(
    row: typeof families.$inferSelect,
  ): Promise<Family> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(familyMembers)
      .where(eq(familyMembers.familyId, row.id));
    return this.toDto(row, value);
  }

  /** One grouped query for a whole list's member counts, keyed by family id. */
  private async countMembersFor(
    familyIds: string[],
  ): Promise<Map<string, number>> {
    if (familyIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ familyId: familyMembers.familyId, value: count() })
      .from(familyMembers)
      .where(inArray(familyMembers.familyId, familyIds))
      .groupBy(familyMembers.familyId);
    return new Map(rows.map((row) => [row.familyId, row.value]));
  }

  private async toDto(
    row: typeof families.$inferSelect,
    memberCount: number,
  ): Promise<Family> {
    const deletedAt = row.deletedAt;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      // Presigned fresh from coverStorageKey when the photo was uploaded
      // through the app (Screen 12); falls back to the plain column.
      coverImageUrl: await resolveCoverImageUrl(this.storageService, row),
      ownerId: row.ownerId,
      memberCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: deletedAt ? deletedAt.toISOString() : null,
      purgeAt: deletedAt
        ? new Date(
            deletedAt.getTime() +
              env.FAMILY_DELETION_GRACE_PERIOD_DAYS * 86_400_000,
          ).toISOString()
        : null,
    };
  }
}
