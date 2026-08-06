import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { reactions } from '../../database/schema';
import { requireTargetAccess } from '../../shared/utils/media-access.util';
import {
  AddReactionInput,
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
    });

    const byEmoji = new Map<string, { count: number; reactedByMe: boolean }>();
    for (const row of rows) {
      const entry = byEmoji.get(row.emoji) ?? { count: 0, reactedByMe: false };
      entry.count += 1;
      if (row.userId === viewerId) entry.reactedByMe = true;
      byEmoji.set(row.emoji, entry);
    }

    return Array.from(byEmoji.entries()).map(
      ([emoji, { count, reactedByMe }]) => ({
        emoji,
        count,
        reactedByMe,
      }),
    );
  }
}
