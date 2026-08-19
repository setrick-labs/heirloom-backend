import {
  BadRequestException,
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
  type RequestCoverUploadUrlInput,
  requestCoverUploadUrlInputSchema,
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

  /** Screens 12/19 — cover photo for a Family or a Journey. */
  @Post('cover-upload-url')
  requestCoverUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(requestCoverUploadUrlInputSchema))
    body: RequestCoverUploadUrlInput,
  ) {
    // A profile picture always belongs to whoever asked for it. Trusting the
    // body's targetId here would let one account mint keys under another's
    // path — harmless on its own (see requestCoverUploadUrl's note: an
    // unreferenced key is inert, and PATCH /users/me binds it to the caller
    // regardless), but it would litter storage with misattributed objects.
    return this.mediaService.requestCoverUploadUrl(
      body.scope === 'user' ? { ...body, targetId: user.id } : body,
    );
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

  /**
   * Scoped by exactly one of milestoneId (Screen 24's grid) or familyId
   * (everything the viewer's family has). milestoneId wins when both are
   * sent — it's strictly narrower, so there's no ambiguity to resolve.
   */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('familyId') familyId?: string,
    @Query('milestoneId') milestoneId?: string,
  ) {
    if (milestoneId) {
      return this.mediaService.listByMilestone(
        user.id,
        idSchema.parse(milestoneId),
      );
    }
    if (familyId) {
      return this.mediaService.listByFamily(user.id, idSchema.parse(familyId));
    }
    throw new BadRequestException('Provide either milestoneId or familyId');
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
