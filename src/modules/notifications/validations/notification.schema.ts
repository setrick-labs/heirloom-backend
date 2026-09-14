import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
} from '../../../shared/validations/common.schema';

export const notificationTypeSchema = z.enum(['comment', 'reaction']);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Same polymorphic target as comments/reactions (database/schema/enums.ts). */
export const notificationTargetTypeSchema = z.enum([
  'milestone',
  'media',
  'moment',
  'event',
  'comment',
]);
export type NotificationTargetType = z.infer<
  typeof notificationTargetTypeSchema
>;

export const notificationSchema = z.object({
  id: idSchema,
  type: notificationTypeSchema,
  targetType: notificationTargetTypeSchema,
  targetId: idSchema,
  /** Null once the underlying memory has been deleted — the row survives, the deep link doesn't. */
  mediaId: idSchema.nullable(),
  title: z.string(),
  body: z.string(),
  actorId: idSchema,
  actorName: z.string(),
  actorAvatarUrl: z.url().nullable(),
  createdAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = paginationQuerySchema;
export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;

export const unreadCountSchema = z.object({
  count: z.number().int().min(0),
});
export type UnreadCount = z.infer<typeof unreadCountSchema>;
