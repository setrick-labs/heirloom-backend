import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { GiftsService } from './gifts.service';
import {
  type CreateGiftInput,
  createGiftInputSchema,
  type UpdateGiftInput,
  updateGiftInputSchema,
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
    return apiResponse(gift, 'Gift scheduled');
  }

  @Get('sent')
  listSent(@CurrentUser() user: AuthenticatedUser) {
    return this.giftsService.listSent(user.id);
  }

  @Get('received')
  listReceived(@CurrentUser() user: AuthenticatedUser) {
    return this.giftsService.listReceived(user.id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.giftsService.getById(user.id, id);
  }

  /** Section 8: pending-only, enforced in the service. */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGiftInputSchema)) body: UpdateGiftInput,
  ) {
    const gift = await this.giftsService.update(user.id, id, body);
    return apiResponse(gift, 'Gift updated');
  }

  @Delete(':id')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const gift = await this.giftsService.cancel(user.id, id);
    return apiResponse(gift, 'Gift cancelled');
  }

  @Post(':id/mark-opened')
  async markOpened(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const gift = await this.giftsService.markOpened(user.id, id);
    return apiResponse(gift, 'OK');
  }
}
