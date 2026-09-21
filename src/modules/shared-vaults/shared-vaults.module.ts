import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { env } from '../../config/env';
import { SharedVaultAccessGuard } from './shared-vault-access.guard';
import { SharedVaultsController } from './shared-vaults.controller';
import { SharedVaultsService } from './shared-vaults.service';

@Module({
  // Same pattern as VaultModule: a default secret here, and every
  // sign/verify call passes its secret explicitly anyway.
  imports: [JwtModule.register({ secret: env.JWT_ACCESS_SECRET })],
  controllers: [SharedVaultsController],
  providers: [SharedVaultsService, SharedVaultAccessGuard],
})
export class SharedVaultsModule {}
