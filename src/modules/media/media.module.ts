import { Module } from '@nestjs/common';

import { MediaController } from './media.controller';
import { MediaProcessingService } from './media-processing.service';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaProcessingService],
  exports: [MediaService, MediaProcessingService],
})
export class MediaModule {}
