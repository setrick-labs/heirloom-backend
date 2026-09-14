import { Controller, Get, Param, Patch, Query } from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { NotificationFeedService } from '../../shared/services/notification-feed.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { idSchema } from '../../shared/validations/common.schema';
import {
  type ListNotificationsQuery,
  listNotificationsQuerySchema,
} from './validations/notification.schema';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationFeedService: NotificationFeedService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema))
    query: ListNotificationsQuery,
  ) {
    return this.notificationFeedService.list(user.id, query.page, query.pageSize);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notificationFeedService.unreadCount(user.id);
    return { count };
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
  ) {
    await this.notificationFeedService.markRead(user.id, id);
    return apiResponse('Marked as read');
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    await this.notificationFeedService.markAllRead(user.id);
    return apiResponse('All marked as read');
  }
}
