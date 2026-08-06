import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { media, milestones } from '../../database/schema';
import {
  CreateMilestoneInput,
  Milestone,
} from './validations/milestone.schema';

@Injectable()
export class MilestonesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async create(
    createdBy: string,
    input: CreateMilestoneInput,
  ): Promise<Milestone> {
    const [created] = await this.db
      .insert(milestones)
      .values({ ...input, date: new Date(input.date), createdBy })
      .returning();
    return this.toDto(created, []);
  }

  async listByJourney(journeyId: string): Promise<Milestone[]> {
    const rows = await this.db.query.milestones.findMany({
      where: eq(milestones.journeyId, journeyId),
    });
    return Promise.all(rows.map((row) => this.withMediaIds(row)));
  }

  async findById(id: string): Promise<Milestone> {
    const milestone = await this.db.query.milestones.findFirst({
      where: eq(milestones.id, id),
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    return this.withMediaIds(milestone);
  }

  private async withMediaIds(
    row: typeof milestones.$inferSelect,
  ): Promise<Milestone> {
    const attached = await this.db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.milestoneId, row.id));
    return this.toDto(
      row,
      attached.map((m) => m.id),
    );
  }

  private toDto(
    row: typeof milestones.$inferSelect,
    mediaIds: string[],
  ): Milestone {
    return {
      id: row.id,
      journeyId: row.journeyId,
      title: row.title,
      description: row.description,
      date: row.date.toISOString(),
      location: row.location,
      mediaIds,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
