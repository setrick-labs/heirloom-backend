import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { idSchema } from '../../shared/validations/common.schema';
import { CommentsService } from './comments.service';
import {
  type CommentTargetType,
  commentTargetTypeSchema,
  type CreateCommentInput,
  createCommentInputSchema,
} from './validations/comment.schema';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCommentInputSchema))
    body: CreateCommentInput,
  ) {
    const comment = await this.commentsService.create(user.id, body);
    return apiResponse(comment, 'Comment added');
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('targetType', new ZodValidationPipe(commentTargetTypeSchema))
    targetType: CommentTargetType,
    @Query('targetId', new ZodValidationPipe(idSchema)) targetId: string,
  ) {
    return this.commentsService.list(user.id, targetType, targetId);
  }

  /** Author-only. */
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.commentsService.delete(user.id, id);
    return apiResponse('Comment removed');
  }
}
