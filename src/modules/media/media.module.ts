import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { MediaController } from './media.controller';
import { MediaProcessingService } from './media-processing.service';
import { MediaService } from './media.service';

@Module({
  // VaultAccessGuard (globally provided, shared.module.ts) is used on this
  // controller's move-to-vault route. The class itself resolves globally,
  // but its own constructor dependency on JwtService still needs JwtModule
  // importable from wherever the guard actually gets instantiated — same
  // reason SharedModule/AuthModule/VaultModule each register it themselves
  // rather than assuming one registration reaches every consumer.
  imports: [JwtModule.register({})],
  controllers: [MediaController],
  providers: [MediaService, MediaProcessingService],
  exports: [MediaService, MediaProcessingService],
})
export class MediaModule {}
