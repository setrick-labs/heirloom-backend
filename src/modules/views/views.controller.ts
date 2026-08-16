import { Body, Controller, Post } from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import {
  type MarkSeenInput,
  markSeenInputSchema,
} from './validations/view.schema';
import { ViewsService } from './views.service';

@Controller('views')
export class ViewsController {
  constructor(private readonly viewsService: ViewsService) {}

  /** Fired when a Journey or Milestone screen opens. Idempotent. */
  @Post()
  async markSeen(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(markSeenInputSchema)) body: MarkSeenInput,
  ) {
    await this.viewsService.markSeen(user.id, body);
    return apiResponse('Marked as seen');
  }
}
