import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { comments } from '../../database/schema';
import { requireTargetAccess } from '../../shared/utils/media-access.util';
import {
  Comment,
  CommentTargetType,
  CreateCommentInput,
} from './validations/comment.schema';

@Injectable()
export class CommentsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  /** Anyone with visibility into the target's journey — not owner-gated. */
  async create(authorId: string, input: CreateCommentInput): Promise<Comment> {
    await requireTargetAccess(
      this.db,
      authorId,
      input.targetType,
      input.targetId,
    );

    const [created] = await this.db
      .insert(comments)
      .values({
        targetType: input.targetType,
        targetId: input.targetId,
        authorId,
        type: input.type,
        body: input.body,
        mediaId: input.mediaId,
      })
      .returning();
    return this.toDto(authorId, created);
  }

  /** One flat, chronological stream — no threading, including 'version' comments (Section 4). */
  async list(
    viewerId: string,
    targetType: CommentTargetType,
    targetId: string,
  ): Promise<Comment[]> {
    await requireTargetAccess(this.db, viewerId, targetType, targetId);
    const rows = await this.db.query.comments.findMany({
      where: and(
        eq(comments.targetType, targetType),
        eq(comments.targetId, targetId),
      ),
      orderBy: asc(comments.createdAt),
    });
    return rows.map((row) => this.toDto(viewerId, row));
  }

  /** Author-only — a person's own contributions are theirs to remove, nobody else's (Section 9). */
  async delete(userId: string, id: string): Promise<void> {
    const row = await this.db.query.comments.findFirst({
      where: eq(comments.id, id),
    });
    if (!row) {
      throw new NotFoundException('Comment not found');
    }
    if (row.authorId !== userId) {
      throw new ForbiddenException(
        'Only the person who posted this can remove it',
      );
    }
    await this.db.delete(comments).where(eq(comments.id, id));
  }

  private toDto(viewerId: string, row: typeof comments.$inferSelect): Comment {
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      authorId: row.authorId,
      type: row.type,
      body: row.body,
      mediaId: row.mediaId,
      canDelete: row.authorId === viewerId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
