import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/**
 * Mirrors frontend/heirloom-mobile/src/schemas/comment.schema.ts field-for-field.
 * `targetType`/`targetId` is polymorphic (see database/schema/enums.ts) but
 * the Milestones spec (Section 3/9) only ever drives 'media' from the
 * client — comments are scoped to a single image/video, never a Milestone
 * as a whole.
 */
export const commentTargetTypeSchema = z.enum([
  'milestone',
  'media',
  'moment',
  'event',
  // A comment is never *written on* a comment — replies use `parentId`. The
  // tag exists so a comment can be reacted to; it is here only because the
  // enum is shared with reactions.
  'comment',
]);
export type CommentTargetType = z.infer<typeof commentTargetTypeSchema>;

/** 'version' is how "add your version" reuses this table — a comment *type*, not a reply-to-a-reply structure (Section 4). */
export const commentTypeSchema = z.enum([
  'text',
  'voice',
  'sticker',
  'version',
]);
export type CommentType = z.infer<typeof commentTypeSchema>;

export const commentSchema = z.object({
  id: idSchema,
  targetType: commentTargetTypeSchema,
  targetId: idSchema,
  authorId: idSchema,
  type: commentTypeSchema.default('text'),
  body: z.string().min(1).max(2000).nullable().optional(),
  mediaId: idSchema.nullable().optional(),
  /** The comment being replied to. Null for a top-level comment. */
  parentId: idSchema.nullable().optional(),
  /** Replies hanging off this one. Always 0 on a reply — depth is capped at 1. */
  replyCount: z.number().int().nonnegative().default(0),
  /** Hearts on this comment, from reactions with targetType 'comment'. */
  likeCount: z.number().int().nonnegative().default(0),
  likedByMe: z.boolean().default(false),
  /** Only the author can remove their own comment (Section 9). */
  canDelete: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Comment = z.infer<typeof commentSchema>;

export const createCommentInputSchema = commentSchema
  .pick({
    targetType: true,
    targetId: true,
    type: true,
    body: true,
    mediaId: true,
    parentId: true,
  })
  .refine(
    (value) =>
      value.type === 'text' || value.type === 'sticker'
        ? Boolean(value.body?.length)
        : true,
    {
      // 'sticker' is a predefined SET (Section 4 — final asset list still
      // open), so its content is an identifier string in `body`, not an
      // upload — unlike 'voice'/'version', it never touches the media table.
      message: 'body is required for text/sticker comments',
      path: ['body'],
    },
  )
  .refine(
    (value) =>
      value.type === 'voice' || value.type === 'version'
        ? Boolean(value.mediaId)
        : true,
    {
      // 'version' ("add your version") is itself a photo/video, not text —
      // its content lives in mediaId, same as a voice recording.
      message: 'mediaId is required for voice/version comments',
      path: ['mediaId'],
    },
  );
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;
