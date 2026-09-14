import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { env } from '../../config/env';
import { MediaModule } from '../media/media.module';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';

@Module({
  imports: [
    // AuthModule follows the same pattern: default config here, every
    // sign/verify call explicitly overrides secret/expiresIn per use.
    JwtModule.register({ secret: env.JWT_ACCESS_SECRET }),
    // For moveToMilestone — MediaService owns every write to the `media`
    // table, so a move reuses its own create() path (announcement push and
    // all) rather than VaultService inserting a media row by hand. One-
    // directional: MediaModule never imports VaultModule back (the reverse
    // move, MediaService.moveToVault, writes to vaultItems directly rather
    // than through VaultService, precisely to avoid that cycle).
    MediaModule,
  ],
  controllers: [VaultController],
  // VaultAccessGuard is provided globally now (shared.module.ts) — Media
  // needs it too, for the exact same reason VaultService needs MediaModule
  // above: one shared piece, not duplicated per module.
  providers: [VaultService],
})
export class VaultModule {}
