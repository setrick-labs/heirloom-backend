import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { gifts } from '../../database/schema';
import { CreateGiftInput, Gift } from './validations/gift.schema';

@Injectable()
export class GiftsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async create(fromUserId: string, input: CreateGiftInput): Promise<Gift> {
    const [created] = await this.db
      .insert(gifts)
      .values({
        ...input,
        fromUserId,
        unlockDate: input.unlockDate ? new Date(input.unlockDate) : undefined,
      })
      .returning();
    return this.toDto(created);
  }

  async listByFamily(familyId: string): Promise<Gift[]> {
    const rows = await this.db.query.gifts.findMany({
      where: eq(gifts.familyId, familyId),
    });
    return rows.map((row) => this.toDto(row));
  }

  async unlock(id: string, userId: string): Promise<Gift> {
    const [updated] = await this.db
      .update(gifts)
      .set({ isUnlocked: true, updatedAt: new Date() })
      .where(and(eq(gifts.id, id), eq(gifts.toUserId, userId)))
      .returning();

    if (!updated) {
      throw new NotFoundException('Gift not found');
    }
    return this.toDto(updated);
  }

  private toDto(row: typeof gifts.$inferSelect): Gift {
    return {
      id: row.id,
      familyId: row.familyId,
      fromUserId: row.fromUserId,
      toUserId: row.toUserId,
      title: row.title,
      message: row.message,
      mediaId: row.mediaId,
      unlockDate: row.unlockDate?.toISOString() ?? null,
      isUnlocked: row.isUnlocked,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
