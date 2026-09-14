import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { notifications, users } from '../../database/schema';
import type {
  Notification,
  NotificationTargetType,
  NotificationType,
} from '../../modules/notifications/validations/notification.schema';
import { resolveStoredImageUrl } from '../utils/cover-url.util';
import { NotificationsGateway } from './notifications.gateway';
import { StorageService } from './storage.service';

const DEFAULT_PAGE_SIZE = 20;

/**
 * The in-app notification bell's durable feed — see the doc comment on the
 * `notifications` table (database/schema/notifications.ts) for how this
 * differs from `NotificationService`, which only ever fires outbound
 * push/email.
 *
 * Every write here is non-throwing, same contract as `NotificationService`:
 * called from inside an operation that has already committed (a comment or
 * reaction landed), so a failure to record it must never surface as a
 * failure of the thing it's announcing.
 */
@Injectable()
export class NotificationFeedService {
  private readonly logger = new Logger(NotificationFeedService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async record(input: {
    recipientId: string;
    actorId: string;
    type: NotificationType;
    targetType: NotificationTargetType;
    targetId: string;
    mediaId: string | null;
    title: string;
    body: string;
  }): Promise<void> {
    try {
      const [row] = await this.db
        .insert(notifications)
        .values({
          recipientId: input.recipientId,
          actorId: input.actorId,
          type: input.type,
          targetType: input.targetType,
          targetId: input.targetId,
          mediaId: input.mediaId,
          title: input.title,
          body: input.body,
        })
        .returning();

      const dto = await this.toDto(row);
      this.gateway.emitNotification(input.recipientId, dto);
    } catch (error) {
      this.logger.error(`Failed to record notification: ${error}`);
    }
  }

  async list(
    userId: string,
    page: number,
    pageSize: number = DEFAULT_PAGE_SIZE,
  ): Promise<Notification[]> {
    const rows = await this.db.query.notifications.findMany({
      where: eq(notifications.recipientId, userId),
      orderBy: desc(notifications.createdAt),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, userId),
          isNull(notifications.readAt),
        ),
      );
    return row?.value ?? 0;
  }

  /** Scoped to the recipient — marking someone else's notification read is not a thing. */
  async markRead(userId: string, id: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.id, id), eq(notifications.recipientId, userId)),
      );
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientId, userId),
          isNull(notifications.readAt),
        ),
      );
  }

  private async toDto(
    row: typeof notifications.$inferSelect,
  ): Promise<Notification> {
    const actor = await this.db.query.users.findFirst({
      where: eq(users.id, row.actorId),
    });
    return {
      id: row.id,
      type: row.type,
      targetType: row.targetType,
      targetId: row.targetId,
      mediaId: row.mediaId,
      title: row.title,
      body: row.body,
      actorId: row.actorId,
      // Falls back to "Someone" only in the pathological case of a deleted
      // actor account outliving the notification — every real notification
      // has a live actor at write time.
      actorName: actor?.name ?? 'Someone',
      actorAvatarUrl: actor
        ? await resolveStoredImageUrl(
            this.storageService,
            actor.avatarStorageKey,
            actor.avatarUrl,
          )
        : null,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    };
  }
}
