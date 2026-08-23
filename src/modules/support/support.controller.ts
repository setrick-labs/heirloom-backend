import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  MAX_SCREENSHOT_BYTES,
  SupportService,
  type SupportScreenshot,
} from './support.service';
import {
  type CreateSupportRequestInput,
  createSupportRequestInputSchema,
} from './validations/support.schema';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  /**
   * Report a problem from inside the app: a title, what happened, and
   * optionally a screenshot.
   *
   * multipart/form-data rather than JSON, so the screenshot travels as bytes
   * instead of a base64 string. Base64 would have meant raising the global
   * JSON body limit — which every other endpoint would then inherit — to
   * carry a payload a third larger than the file itself.
   *
   * Throttled well below the global default: this is the one authenticated
   * endpoint that makes the server send mail on demand, so the ceiling is
   * "a person having a bad afternoon", not "a script".
   */
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post()
  @UseInterceptors(
    FileInterceptor('screenshot', {
      limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1 },
    }),
  )
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSupportRequestInputSchema))
    body: CreateSupportRequestInput,
    @UploadedFile() screenshot?: SupportScreenshot,
  ) {
    return this.supportService.submit(user.id, body, screenshot);
  }
}
