import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { journeys, milestones } from '../../database/schema';
import { CreateJourneyInput, Journey } from './validations/journey.schema';

@Injectable()
export class JourneysService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async create(createdBy: string, input: CreateJourneyInput): Promise<Journey> {
    const [created] = await this.db
      .insert(journeys)
      .values({
        ...input,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        createdBy,
      })
      .returning();
    return this.toDto(created, 0);
  }

  async listByFamily(familyId: string): Promise<Journey[]> {
    const rows = await this.db.query.journeys.findMany({
      where: eq(journeys.familyId, familyId),
    });
    return Promise.all(rows.map((row) => this.withMilestoneCount(row)));
  }

  async findById(id: string): Promise<Journey> {
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, id),
    });
    if (!journey) {
      throw new NotFoundException('Journey not found');
    }
    return this.withMilestoneCount(journey);
  }

  private async withMilestoneCount(
    row: typeof journeys.$inferSelect,
  ): Promise<Journey> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(milestones)
      .where(eq(milestones.journeyId, row.id));
    return this.toDto(row, value);
  }

  private toDto(
    row: typeof journeys.$inferSelect,
    milestoneCount: number,
  ): Journey {
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
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
