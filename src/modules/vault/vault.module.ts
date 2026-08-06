import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { env } from '../../config/env';
import { VaultAccessGuard } from './vault-access.guard';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';

@Module({
  // AuthModule follows the same pattern: default config here, every
  // sign/verify call explicitly overrides secret/expiresIn per use.
  imports: [JwtModule.register({ secret: env.JWT_ACCESS_SECRET })],
  controllers: [VaultController],
  providers: [VaultService, VaultAccessGuard],
})
export class VaultModule {}
