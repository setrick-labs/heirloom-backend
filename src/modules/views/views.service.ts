import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { DATABASE_CONNECTION } from '../../database/database.module';
import { contentViews, milestones } from '../../database/schema';
import { requireJourneyAccess } from '../../shared/utils/journey-access.util';
import type { MarkSeenInput } from './validations/view.schema';

@Injectable()
export class ViewsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  /**
   * Moves this viewer's read watermark to now. Access is checked first —
   * without it, this endpoint would confirm whether an arbitrary journey id
   * exists, which is exactly what requireJourneyAccess's uniform NOT_FOUND
   * is there to prevent.
   *
   * Reads the milestone's parent journey directly rather than injecting
   * MilestonesService: this is a one-column lookup, and MilestonesModule
   * would otherwise have to be imported here purely to resolve a foreign
   * key that is right there on the row.
   */
  async markSeen(userId: string, input: MarkSeenInput): Promise<void> {
    const journeyId =
      input.targetType === 'journey'
        ? input.targetId
        : await this.resolveJourneyId(input.targetId);

    await requireJourneyAccess(this.db, userId, journeyId);

    await this.db
      .insert(contentViews)
      .values({
        userId,
        targetType: input.targetType,
        targetId: input.targetId,
      })
      .onConflictDoUpdate({
        target: [
          contentViews.userId,
          contentViews.targetType,
          contentViews.targetId,
        ],
        // GREATEST, not a plain assignment: two screens can report "seen"
        // out of order (a slow journey-level request landing after a
        // milestone-level one), and the watermark must never move backwards
        // or already-read content would re-badge itself.
        set: { lastSeenAt: sql`greatest(${contentViews.lastSeenAt}, now())` },
      });
  }

  private async resolveJourneyId(milestoneId: string): Promise<string> {
    const row = await this.db.query.milestones.findFirst({
      where: and(eq(milestones.id, milestoneId), isNull(milestones.deletedAt)),
      columns: { journeyId: true },
    });
    if (!row) {
      throw new NotFoundException('Milestone not found');
    }
    return row.journeyId;
  }
}
