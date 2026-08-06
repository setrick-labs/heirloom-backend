import { Controller, Get, Param, Post, Query, Body } from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { idSchema } from '../../shared/validations/common.schema';
import { GiftsService } from './gifts.service';
import {
  type CreateGiftInput,
  createGiftInputSchema,
} from './validations/gift.schema';

@Controller('gifts')
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createGiftInputSchema)) body: CreateGiftInput,
  ) {
    const gift = await this.giftsService.create(user.id, body);
    return apiResponse(gift, 'Gift created');
  }

  @Get()
  list(@Query('familyId', new ZodValidationPipe(idSchema)) familyId: string) {
    return this.giftsService.listByFamily(familyId);
  }

  @Post(':id/unlock')
  async unlock(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const gift = await this.giftsService.unlock(id, user.id);
    return apiResponse(gift, 'Gift unlocked');
  }
}
