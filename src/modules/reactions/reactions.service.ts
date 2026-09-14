import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { media, reactions, users } from '../../database/schema';
import { NotificationService } from '../../shared/services/notification.service';
import { NotificationsGateway } from '../../shared/services/notifications.gateway';
import { requireTargetAccess } from '../../shared/utils/media-access.util';
import {
  AddReactionInput,
  REACTOR_NAMES_LIMIT,
  ReactionSummary,
  ReactionTargetType,
} from './validations/reaction.schema';

@Injectable()
export class ReactionsService {
  private readonly logger = new Logger(ReactionsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly notificationService: NotificationService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Idempotent add — Section 5 recommends allowing multiple reaction types
   * per person per image (❤️ *and* 😂 on the same photo), so this only
   * dedupes the exact same (target, person, emoji) triple, via the DB's own
   * unique constraint. A second identical POST is a no-op, not an error.
   */
  async add(userId: string, input: AddReactionInput): Promise<void> {
    await requireTargetAccess(
      this.db,
      userId,
      input.targetType,
      input.targetId,
    );
    const inserted = await this.db
      .insert(reactions)
      .values({
        targetType: input.targetType,
        targetId: input.targetId,
        userId,
        emoji: input.emoji,
      })
      .onConflictDoNothing()
      .returning();

    // Nothing returned means the same person had already left the same emoji
    // on the same thing. Re-notifying on a no-op would let anyone ping a
    // photo's owner repeatedly by tapping a reaction they had already left.
    if (inserted.length > 0) {
      this.notificationsGateway.emitActivity(input.targetType, input.targetId);
      void this.announceReaction(userId, input);
    }
  }

  /**
   * Tells the owner of the memory, and nobody else.
   *
   * Reactions on comments ('comment' targets) stay silent by design: liking
   * a reply is the lightest possible acknowledgement, and turning it into a
   * push would make the quietest gesture in the app the loudest.
   */
  private async announceReaction(
    userId: string,
    input: AddReactionInput,
  ): Promise<void> {
    try {
      if (input.targetType !== 'media') return;

      const [target, actor] = await Promise.all([
        this.db.query.media.findFirst({ where: eq(media.id, input.targetId) }),
        this.db.query.users.findFirst({ where: eq(users.id, userId) }),
      ]);
      if (!target || !actor) return;

      await this.notificationService.pushReaction({
        actorId: userId,
        actorName: actor.name,
        ownerId: target.ownerId,
        mediaId: input.targetId,
        emoji: input.emoji,
      });
    } catch (error) {
      this.logger.error(`Failed to announce reaction: ${error}`);
    }
  }

  async remove(
    userId: string,
    targetType: ReactionTargetType,
    targetId: string,
    emoji: string,
  ): Promise<void> {
    await this.db
      .delete(reactions)
      .where(
        and(
          eq(reactions.targetType, targetType),
          eq(reactions.targetId, targetId),
          eq(reactions.userId, userId),
          eq(reactions.emoji, emoji),
        ),
      );
  }

  /** Grouped by emoji, for the reaction bar. */
  async list(
    viewerId: string,
    targetType: ReactionTargetType,
    targetId: string,
  ): Promise<ReactionSummary[]> {
    await requireTargetAccess(this.db, viewerId, targetType, targetId);
    const rows = await this.db.query.reactions.findMany({
      where: and(
        eq(reactions.targetType, targetType),
        eq(reactions.targetId, targetId),
      ),
      // Oldest first, so a capped reactorIds list below names the earliest
      // reactors — the same "who reacted first" ordering people expect from
      // a "Liked by X and N more" line.
      orderBy: (row, { asc }) => [asc(row.createdAt)],
    });

    const byEmoji = new Map<
      string,
      { count: number; reactedByMe: boolean; reactorIds: string[] }
    >();
    for (const row of rows) {
      const entry = byEmoji.get(row.emoji) ?? {
        count: 0,
        reactedByMe: false,
        reactorIds: [],
      };
      entry.count += 1;
      if (row.userId === viewerId) entry.reactedByMe = true;
      // Capped — the UI only ever names a handful of people regardless of
      // how large the count gets, and an uncapped list would grow the
      // payload with a popular photo for no benefit.
      if (entry.reactorIds.length < REACTOR_NAMES_LIMIT) {
        entry.reactorIds.push(row.userId);
      }
      byEmoji.set(row.emoji, entry);
    }

    return Array.from(byEmoji.entries()).map(
      ([emoji, { count, reactedByMe, reactorIds }]) => ({
        emoji,
        count,
        reactedByMe,
        reactorIds,
      }),
    );
  }

  /**
   * The full "Liked by" list for one emoji on one target — everyone, not
   * the `REACTOR_NAMES_LIMIT`-capped preview `list()` returns. Oldest first,
   * same ordering as the capped list, so the preview's names are always a
   * prefix of this one rather than a different sample.
   */
  async listReactors(
    viewerId: string,
    targetType: ReactionTargetType,
    targetId: string,
    emoji: string,
  ): Promise<string[]> {
    await requireTargetAccess(this.db, viewerId, targetType, targetId);
    const rows = await this.db.query.reactions.findMany({
      where: and(
        eq(reactions.targetType, targetType),
        eq(reactions.targetId, targetId),
        eq(reactions.emoji, emoji),
      ),
      orderBy: (row, { asc }) => [asc(row.createdAt)],
      columns: { userId: true },
    });
    return rows.map((row) => row.userId);
  }
}
