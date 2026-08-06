import { Controller, Get, Param, Post, Query, Body } from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { idSchema } from '../../shared/validations/common.schema';
import { MediaService } from './media.service';
import {
  type CreateMediaInput,
  createMediaInputSchema,
  type RequestUploadUrlInput,
  requestUploadUrlInputSchema,
} from './validations/media.schema';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-url')
  requestUploadUrl(
    @Body(new ZodValidationPipe(requestUploadUrlInputSchema))
    body: RequestUploadUrlInput,
  ) {
    return this.mediaService.requestUploadUrl(body);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMediaInputSchema)) body: CreateMediaInput,
  ) {
    const created = await this.mediaService.create(user.id, body);
    return apiResponse(created, 'Media registered');
  }

  @Get()
  list(@Query('familyId', new ZodValidationPipe(idSchema)) familyId: string) {
    return this.mediaService.listByFamily(familyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mediaService.findById(id);
  }
}
