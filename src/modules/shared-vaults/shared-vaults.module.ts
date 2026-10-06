import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { env } from '../../config/env';
import { MediaModule } from '../media/media.module';
import { SharedVaultAccessGuard } from './shared-vault-access.guard';
import { SharedVaultsController } from './shared-vaults.controller';
import { SharedVaultsService } from './shared-vaults.service';

@Module({
  // Same pattern as VaultModule: a default secret here, and every
  // sign/verify call passes its secret explicitly anyway.
  imports: [
    JwtModule.register({ secret: env.JWT_ACCESS_SECRET }),
    // For MediaProcessingService: shared vault photos and videos go through
    // the same processing as every other upload.
    MediaModule,
  ],
  controllers: [SharedVaultsController],
  providers: [SharedVaultsService, SharedVaultAccessGuard],
  // Account deletion leaves each shared vault through the same path.
  exports: [SharedVaultsService],
})
export class SharedVaultsModule {}
