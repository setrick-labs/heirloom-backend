import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';

import { z } from 'zod';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { idSchema } from '../../shared/validations/common.schema';
import { ReactionsService } from './reactions.service';
import {
  type AddReactionInput,
  addReactionInputSchema,
  type ReactionTargetType,
  reactionTargetTypeSchema,
} from './validations/reaction.schema';

@Controller('reactions')
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  @Post()
  async add(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addReactionInputSchema)) body: AddReactionInput,
  ) {
    await this.reactionsService.add(user.id, body);
    return apiResponse('Reaction added');
  }

  @Delete()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Query('targetType', new ZodValidationPipe(reactionTargetTypeSchema))
    targetType: ReactionTargetType,
    @Query('targetId', new ZodValidationPipe(idSchema)) targetId: string,
    @Query('emoji', new ZodValidationPipe(z.string().min(1).max(16)))
    emoji: string,
  ) {
    await this.reactionsService.remove(user.id, targetType, targetId, emoji);
    return apiResponse('Reaction removed');
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('targetType', new ZodValidationPipe(reactionTargetTypeSchema))
    targetType: ReactionTargetType,
    @Query('targetId', new ZodValidationPipe(idSchema)) targetId: string,
  ) {
    return this.reactionsService.list(user.id, targetType, targetId);
  }
}
