import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Body,
} from '@nestjs/common';

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
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(requestUploadUrlInputSchema))
    body: RequestUploadUrlInput,
  ) {
    return this.mediaService.requestUploadUrl(user.id, body);
  }

  /** Section 6: anyone with visibility into the milestone's journey, not just its creator. */
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMediaInputSchema)) body: CreateMediaInput,
  ) {
    const created = await this.mediaService.create(user.id, body);
    return apiResponse(created, 'Media added');
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('familyId', new ZodValidationPipe(idSchema)) familyId: string,
  ) {
    return this.mediaService.listByFamily(user.id, familyId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.mediaService.findById(user.id, id);
  }

  /** Section 8: uploader-only. */
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.mediaService.delete(user.id, id);
    return apiResponse('Media removed');
  }
}
