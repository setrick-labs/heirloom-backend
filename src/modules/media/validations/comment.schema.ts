import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/**
 * Mirrors frontend/heirloom-mobile/src/schemas/comment.schema.ts field-for-field,
 * plus `type`, which database/schema/comments.ts requires (text/voice/sticker/
 * version — "add your version" reuses this table via type: 'version') but
 * predates that field on the mobile side.
 *
 * Lives under modules/media/validations rather than its own module since
 * this backend doesn't have a standalone comments module — comments only
 * ever attach to a milestone or a media item.
 */
export const commentTargetTypeSchema = z.enum([
  'milestone',
  'media',
  'moment',
  'event',
]);
export type CommentTargetType = z.infer<typeof commentTargetTypeSchema>;

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
  })
  .refine((value) => value.type !== 'text' || Boolean(value.body?.length), {
    message: 'body is required for text comments',
    path: ['body'],
  })
  .refine(
    (value) =>
      value.type === 'voice' || value.type === 'sticker'
        ? Boolean(value.mediaId)
        : true,
    {
      message: 'mediaId is required for voice/sticker comments',
      path: ['mediaId'],
    },
  );
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;

export const updateCommentInputSchema = commentSchema.pick({ body: true });
export type UpdateCommentInput = z.infer<typeof updateCommentInputSchema>;
