import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, max } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  aliases,
  familyMembers,
  journeyMembers,
  journeys,
  milestones,
  users,
} from '../../database/schema';
import { isActiveFamilyMember } from '../../shared/utils/family-membership.util';
import {
  requireJourneyAccess,
  requireJourneyOwner,
} from '../../shared/utils/journey-access.util';
import { GiftsService } from '../gifts/gifts.service';
import type { JourneyMemberView } from './validations/journey-member.schema';
import {
  AddJourneyMembersInput,
  CreateJourneyInput,
  Journey,
  RenameJourneyInput,
  SetVisibilityInput,
} from './validations/journey.schema';

type JourneyRow = typeof journeys.$inferSelect;

@Injectable()
export class JourneysService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly giftsService: GiftsService,
  ) {}

  async create(userId: string, input: CreateJourneyInput): Promise<Journey> {
    if (!(await isActiveFamilyMember(this.db, userId, input.familyId))) {
      throw new ForbiddenException('You are not a member of this family');
    }
    if (input.visibilityType === 'selected') {
      await this.assertAllAreFamilyMembers(input.familyId, input.memberUserIds);
    }

    const journey = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(journeys)
        .values({
          familyId: input.familyId,
          title: input.title,
          description: input.description,
          visibilityType: input.visibilityType,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          createdBy: userId,
        })
        .returning();

      if (input.visibilityType === 'selected') {
        await tx.insert(journeyMembers).values(
          input.memberUserIds.map((memberUserId) => ({
            journeyId: created.id,
            userId: memberUserId,
          })),
        );
      }

      return created;
    });

    return this.withComputedFields(userId, journey);
  }

  /** Section 5: only what the viewer can see, sorted by most recent activity. */
  async listForFamily(userId: string, familyId: string): Promise<Journey[]> {
    if (!(await isActiveFamilyMember(this.db, userId, familyId))) {
      throw new ForbiddenException('You are not a member of this family');
    }

    const rows = await this.db.query.journeys.findMany({
      where: and(eq(journeys.familyId, familyId), isNull(journeys.deletedAt)),
    });

    const selectedJourneyIds = rows
      .filter((row) => row.visibilityType === 'selected')
      .map((row) => row.id);
    const myMemberships = selectedJourneyIds.length
      ? await this.db.query.journeyMembers.findMany({
          where: and(
            inArray(journeyMembers.journeyId, selectedJourneyIds),
            eq(journeyMembers.userId, userId),
          ),
        })
      : [];
    const myMemberJourneyIds = new Set(myMemberships.map((m) => m.journeyId));

    const visible = rows.filter(
      (row) =>
        row.createdBy === userId ||
        row.visibilityType === 'all' ||
        myMemberJourneyIds.has(row.id),
    );

    // Batched instead of one count + one max(createdAt) query per journey
    // (was N+1 — a 10-journey family meant 20 extra round trips here).
    const visibleIds = visible.map((row) => row.id);
    const [counts, latestActivity] = visibleIds.length
      ? await Promise.all([
          this.db
            .select({ journeyId: milestones.journeyId, value: count() })
            .from(milestones)
            .where(
              and(
                inArray(milestones.journeyId, visibleIds),
                isNull(milestones.deletedAt),
              ),
            )
            .groupBy(milestones.journeyId),
          this.db
            .select({
              journeyId: milestones.journeyId,
              latest: max(milestones.createdAt),
            })
            .from(milestones)
            .where(
              and(
                inArray(milestones.journeyId, visibleIds),
                isNull(milestones.deletedAt),
              ),
            )
            .groupBy(milestones.journeyId),
        ])
      : [[], []];
    const countByJourneyId = new Map(
      counts.map((row) => [row.journeyId, row.value]),
    );
    const latestByJourneyId = new Map(
      latestActivity.map((row) => [row.journeyId, row.latest]),
    );

    const dtos = visible.map((row) => {
      const latestMilestoneAt = latestByJourneyId.get(row.id);
      const lastActivityAt =
        latestMilestoneAt && latestMilestoneAt > row.updatedAt
          ? latestMilestoneAt
          : row.updatedAt;
      return this.toDto(
        userId,
        row,
        countByJourneyId.get(row.id) ?? 0,
        lastActivityAt,
      );
    });
    return dtos.sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime(),
    );
  }

  async findById(userId: string, journeyId: string): Promise<Journey> {
    await requireJourneyAccess(this.db, userId, journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Journey not found');
    }
    return this.withComputedFields(userId, journey);
  }

  /** Section 4: owner-only. */
  async rename(
    userId: string,
    journeyId: string,
    input: RenameJourneyInput,
  ): Promise<Journey> {
    await requireJourneyOwner(this.db, userId, journeyId);
    const [updated] = await this.db
      .update(journeys)
      .set({ title: input.title, updatedAt: new Date() })
      .where(eq(journeys.id, journeyId))
      .returning();
    return this.withComputedFields(userId, updated);
  }

  /** Section 3: owner-only; switching to 'selected' always replaces the member list wholesale. */
  async setVisibility(
    userId: string,
    journeyId: string,
    input: SetVisibilityInput,
  ): Promise<Journey> {
    await requireJourneyOwner(this.db, userId, journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Journey not found');
    }
    if (input.visibilityType === 'selected') {
      await this.assertAllAreFamilyMembers(
        journey.familyId,
        input.memberUserIds,
      );
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(journeys)
        .set({ visibilityType: input.visibilityType, updatedAt: new Date() })
        .where(eq(journeys.id, journeyId))
        .returning();
      await tx
        .delete(journeyMembers)
        .where(eq(journeyMembers.journeyId, journeyId));
      if (input.visibilityType === 'selected') {
        await tx.insert(journeyMembers).values(
          input.memberUserIds.map((memberUserId) => ({
            journeyId,
            userId: memberUserId,
          })),
        );
      }
      return row;
    });

    return this.withComputedFields(userId, updated);
  }

  /** Section 3: owner-only, 'selected' journeys only. */
  async addMembers(
    userId: string,
    journeyId: string,
    input: AddJourneyMembersInput,
  ): Promise<void> {
    await requireJourneyOwner(this.db, userId, journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Journey not found');
    }
    if (journey.visibilityType !== 'selected') {
      throw new ForbiddenException(
        'Switch this journey to "Selected Members" before adding individual members',
      );
    }
    await this.assertAllAreFamilyMembers(journey.familyId, input.userIds);

    for (const memberUserId of input.userIds) {
      await this.db
        .insert(journeyMembers)
        .values({ journeyId, userId: memberUserId })
        .onConflictDoNothing();
    }
  }

  /** Section 3 edge case: removing the owner isn't meaningful — rejected, not just hidden from the UI. */
  async removeMember(
    userId: string,
    journeyId: string,
    targetUserId: string,
  ): Promise<void> {
    await requireJourneyOwner(this.db, userId, journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Journey not found');
    }
    if (targetUserId === journey.createdBy) {
      throw new ForbiddenException(
        'The owner can’t be removed from their own journey',
      );
    }

    await this.db
      .delete(journeyMembers)
      .where(
        and(
          eq(journeyMembers.journeyId, journeyId),
          eq(journeyMembers.userId, targetUserId),
        ),
      );
  }

  /** "Who has access" — for 'all' journeys this is computed from current family membership, not stored. */
  async getMembers(
    userId: string,
    journeyId: string,
  ): Promise<JourneyMemberView[]> {
    await requireJourneyAccess(this.db, userId, journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Journey not found');
    }

    let memberUserIds: string[];
    if (journey.visibilityType === 'all') {
      const rows = await this.db.query.familyMembers.findMany({
        where: eq(familyMembers.familyId, journey.familyId),
      });
      memberUserIds = rows.map((row) => row.userId);
    } else {
      const rows = await this.db.query.journeyMembers.findMany({
        where: eq(journeyMembers.journeyId, journeyId),
      });
      memberUserIds = rows.map((row) => row.userId);
      if (!memberUserIds.includes(journey.createdBy)) {
        memberUserIds = [...memberUserIds, journey.createdBy];
      }
    }

    const userRows = await this.db.query.users.findMany({
      where: inArray(users.id, memberUserIds),
    });
    const aliasRows = await this.db.query.aliases.findMany({
      where: and(
        eq(aliases.familyId, journey.familyId),
        eq(aliases.viewerUserId, userId),
      ),
    });
    const aliasByTarget = new Map(
      aliasRows.map((row) => [row.subjectUserId, row.nickname]),
    );

    return userRows.map((row) => {
      const alias = aliasByTarget.get(row.id);
      return {
        userId: row.id,
        displayName: row.name,
        resolvedName: alias ?? row.name,
        isOwner: row.id === journey.createdBy,
      };
    });
  }

  /** Section 7: soft-delete with a grace period, owner-only. */
  async initiateDelete(userId: string, journeyId: string): Promise<Journey> {
    await requireJourneyOwner(this.db, userId, journeyId);
    const [updated] = await this.db
      .update(journeys)
      .set({ deletedAt: new Date() })
      .where(eq(journeys.id, journeyId))
      .returning();
    // Gifting spec Section 7: a Gift pointing at a deleted Journey has
    // nothing left to deliver — fail it gracefully rather than let it try
    // to send an invite/reveal for content that no longer exists.
    await this.giftsService.cancelAllForJourney(journeyId);
    return this.withComputedFields(userId, updated);
  }

  /** Available only during the grace period. */
  async cancelDelete(userId: string, journeyId: string): Promise<Journey> {
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, journeyId),
    });
    if (!journey?.deletedAt) {
      throw new NotFoundException('This journey is not pending deletion.');
    }
    if (journey.createdBy !== userId) {
      throw new ForbiddenException('Only this journey’s owner can do that');
    }

    const graceDeadline = new Date(
      journey.deletedAt.getTime() +
        env.JOURNEY_DELETION_GRACE_PERIOD_DAYS * 86_400_000,
    );
    if (graceDeadline <= new Date()) {
      throw new ForbiddenException(
        'The recovery window for this journey has passed.',
      );
    }

    const [updated] = await this.db
      .update(journeys)
      .set({ deletedAt: null })
      .where(eq(journeys.id, journeyId))
      .returning();
    return this.withComputedFields(userId, updated);
  }

  private async assertAllAreFamilyMembers(
    familyId: string,
    userIds: string[],
  ): Promise<void> {
    const rows = await this.db.query.familyMembers.findMany({
      where: and(
        eq(familyMembers.familyId, familyId),
        inArray(familyMembers.userId, userIds),
      ),
    });
    if (rows.length !== new Set(userIds).size) {
      throw new ForbiddenException(
        'One or more selected people are not members of this family',
      );
    }
  }

  private async withComputedFields(
    userId: string,
    row: JourneyRow,
  ): Promise<Journey> {
    const [{ value: milestoneCount }] = await this.db
      .select({ value: count() })
      .from(milestones)
      .where(
        and(eq(milestones.journeyId, row.id), isNull(milestones.deletedAt)),
      );

    const [latestMilestone] = await this.db
      .select({ createdAt: milestones.createdAt })
      .from(milestones)
      .where(
        and(eq(milestones.journeyId, row.id), isNull(milestones.deletedAt)),
      )
      .orderBy(desc(milestones.createdAt))
      .limit(1);

    const lastActivityAt =
      latestMilestone && latestMilestone.createdAt > row.updatedAt
        ? latestMilestone.createdAt
        : row.updatedAt;

    return this.toDto(userId, row, milestoneCount, lastActivityAt);
  }

  private toDto(
    userId: string,
    row: JourneyRow,
    milestoneCount: number,
    lastActivityAt: Date,
  ): Journey {
    const deletedAt = row.deletedAt;
    return {
      id: row.id,
      familyId: row.familyId,
      title: row.title,
      description: row.description,
      coverImageUrl: row.coverImageUrl,
      startDate: row.startDate?.toISOString() ?? null,
      endDate: row.endDate?.toISOString() ?? null,
      visibilityType: row.visibilityType,
      milestoneCount,
      lastActivityAt: lastActivityAt.toISOString(),
      createdBy: row.createdBy,
      isOwner: row.createdBy === userId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: deletedAt ? deletedAt.toISOString() : null,
      purgeAt: deletedAt
        ? new Date(
            deletedAt.getTime() +
              env.JOURNEY_DELETION_GRACE_PERIOD_DAYS * 86_400_000,
          ).toISOString()
        : null,
    };
  }
}
