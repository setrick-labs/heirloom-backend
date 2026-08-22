import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { comments, reactions } from '../../database/schema';
import { MediaService } from '../media/media.service';
import type { Media } from '../media/validations/media.schema';
import { requireTargetAccess } from '../../shared/utils/media-access.util';
import { isActiveFamilyMember } from '../../shared/utils/family-membership.util';
import {
  REACTOR_NAMES_LIMIT,
  ReactionSummary,
} from '../reactions/validations/reaction.schema';
import {
  Comment,
  CommentTargetType,
  CreateCommentInput,
} from './validations/comment.schema';

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly mediaService: MediaService,
  ) {}

  /** Anyone with visibility into the target's journey — not owner-gated. */
  async create(authorId: string, input: CreateCommentInput): Promise<Comment> {
    await requireTargetAccess(
      this.db,
      authorId,
      input.targetType,
      input.targetId,
    );

    if (input.parentId) {
      await this.assertRepliableParent(input);
    }

    // `CommentsService.create()` used to insert whatever `mediaId` a client
    // sent with no check at all — nothing stopped one family's comment from
    // pointing at another family's photo. Resolving (and gating) it here,
    // once, also means the freshly-created comment's response can carry the
    // attachment directly rather than the caller needing a second request.
    let attachment: Media | null = null;
    if (input.mediaId) {
      attachment = await this.mediaService.resolveForComment(input.mediaId);
      if (!attachment) {
        throw new NotFoundException('Attachment not found');
      }
      if (!(await isActiveFamilyMember(this.db, authorId, attachment.familyId))) {
        throw new ForbiddenException("You don't have access to that attachment");
      }
    }

    const [created] = await this.db
      .insert(comments)
      .values({
        targetType: input.targetType,
        targetId: input.targetId,
        authorId,
        type: input.type,
        body: input.body,
        mediaId: input.mediaId,
        parentId: input.parentId ?? null,
      })
      .returning();
    return this.toDto(authorId, created, {
      replyCount: 0,
      reactions: [],
      attachment,
    });
  }

  /**
   * A reply must point at a top-level comment on the same target.
   *
   * Two things are being refused. Replying across targets would let a comment
   * on one photo be threaded under another, which no screen could render
   * coherently. Replying to a reply would make the thread arbitrarily deep,
   * and the sheet draws exactly two levels — so the limit is enforced where
   * it can actually hold, rather than hoped for in the client.
   */
  private async assertRepliableParent(input: CreateCommentInput) {
    const parent = await this.db.query.comments.findFirst({
      where: eq(comments.id, input.parentId!),
    });
    if (!parent) {
      throw new NotFoundException('The comment being replied to no longer exists');
    }
    if (
      parent.targetType !== input.targetType ||
      parent.targetId !== input.targetId
    ) {
      throw new ForbiddenException('That comment belongs to something else');
    }
    if (parent.parentId) {
      throw new ForbiddenException('Replies only go one level deep');
    }
  }

  /**
   * One chronological stream, parents and replies together, including
   * 'version' comments (Section 4).
   *
   * Deliberately still flat on the wire. The client groups by `parentId` to
   * draw the two levels, and a flat list keeps this to three queries however
   * many replies there are — nesting server-side would mean either a
   * recursive query or one round trip per parent.
   */
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
    if (rows.length === 0) return [];

    const reactionRows = await this.db.query.reactions.findMany({
      where: and(
        eq(reactions.targetType, 'comment'),
        inArray(
          reactions.targetId,
          rows.map((row) => row.id),
        ),
      ),
    });

    // Grouped by (comment, emoji) — same shape ReactionsService.list() builds
    // for media, just keyed one level deeper since this covers every comment
    // on the target in one pass rather than one target at a time.
    type ReactionEntry = {
      count: number;
      reactedByMe: boolean;
      reactorIds: string[];
    };
    const reactionsByComment = new Map<string, Map<string, ReactionEntry>>();
    for (const row of reactionRows) {
      const byEmoji =
        reactionsByComment.get(row.targetId) ?? new Map<string, ReactionEntry>();
      const entry = byEmoji.get(row.emoji) ?? {
        count: 0,
        reactedByMe: false,
        reactorIds: [],
      };
      entry.count += 1;
      if (row.userId === viewerId) entry.reactedByMe = true;
      if (entry.reactorIds.length < REACTOR_NAMES_LIMIT) {
        entry.reactorIds.push(row.userId);
      }
      byEmoji.set(row.emoji, entry);
      reactionsByComment.set(row.targetId, byEmoji);
    }
    const summariesFor = (commentId: string): ReactionSummary[] =>
      Array.from(reactionsByComment.get(commentId) ?? [], ([emoji, entry]) => ({
        emoji,
        ...entry,
      }));

    const replyCounts = new Map<string, number>();
    for (const row of rows) {
      if (!row.parentId) continue;
      replyCounts.set(row.parentId, (replyCounts.get(row.parentId) ?? 0) + 1);
    }

    // One extra lookup per attachment, not per comment — most comments have
    // none, and this is a new, low-volume feature rather than a hot path
    // worth a batched query for yet.
    return Promise.all(
      rows.map((row) =>
        this.toDto(viewerId, row, {
          replyCount: replyCounts.get(row.id) ?? 0,
          reactions: summariesFor(row.id),
        }),
      ),
    );
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

  private async toDto(
    viewerId: string,
    row: typeof comments.$inferSelect,
    extras: {
      replyCount?: number;
      reactions?: ReactionSummary[];
      /** Pass this when already resolved (create()) to skip a redundant lookup; omit to resolve it here (list()). */
      attachment?: Media | null;
    } = {},
  ): Promise<Comment> {
    const attachment =
      extras.attachment !== undefined
        ? extras.attachment
        : row.mediaId
          ? await this.mediaService.resolveForComment(row.mediaId)
          : null;

    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      authorId: row.authorId,
      type: row.type,
      body: row.body,
      mediaId: row.mediaId,
      attachment,
      parentId: row.parentId,
      replyCount: extras.replyCount ?? 0,
      reactions: extras.reactions ?? [],
      canDelete: row.authorId === viewerId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
