import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { reactions } from '../../database/schema';
import { requireTargetAccess } from '../../shared/utils/media-access.util';
import {
  AddReactionInput,
  REACTOR_NAMES_LIMIT,
  ReactionSummary,
  ReactionTargetType,
} from './validations/reaction.schema';

@Injectable()
export class ReactionsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

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
    await this.db
      .insert(reactions)
      .values({
        targetType: input.targetType,
        targetId: input.targetId,
        userId,
        emoji: input.emoji,
      })
      .onConflictDoNothing();
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
}
