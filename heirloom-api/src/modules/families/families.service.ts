import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, gt, isNull } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  familyInvites,
  familyMembers,
  families,
  users,
} from '../../database/schema';
import { generateNumericCode } from '../../shared/utils/auth-tokens.util';
import { getFamilyMembership } from '../../shared/utils/family-membership.util';
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
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

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
      .where(eq(familyMembers.userId, userId));

    return Promise.all(rows.map((row) => this.withMemberCount(row.family)));
  }

  async findById(id: string): Promise<Family> {
    const family = await this.db.query.families.findFirst({
      where: eq(families.id, id),
    });
    if (!family) {
      throw new NotFoundException('Family not found');
    }
    return this.withMemberCount(family);
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

  private async requireAdmin(userId: string, familyId: string): Promise<void> {
    const membership = await getFamilyMembership(this.db, userId, familyId);
    if (!membership || !ADMIN_ROLES.has(membership.role)) {
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

  private async withMemberCount(
    row: typeof families.$inferSelect,
  ): Promise<Family> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(familyMembers)
      .where(eq(familyMembers.familyId, row.id));
    return this.toDto(row, value);
  }

  private toDto(
    row: typeof families.$inferSelect,
    memberCount: number,
  ): Family {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      coverImageUrl: row.coverImageUrl,
      ownerId: row.ownerId,
      memberCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
