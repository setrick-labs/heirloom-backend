import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';

/**
 * Controller-only: `NotificationFeedService` and `NotificationsGateway` live
 * in `SharedModule` (global) because they're also injected from
 * `NotificationService` (comment/reaction push) and from
 * `CommentsService`/`ReactionsService` (the `activity:new` broadcast) — the
 * same reason `StorageService`/`MailerService` live there rather than in a
 * feature module of their own.
 */
@Module({
  controllers: [NotificationsController],
})
export class NotificationsModule {}
