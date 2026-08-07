import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { env } from '../../config/env';
import { asDuration } from '../../shared/types/duration';
import { GiftsModule } from '../gifts/gifts.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // Default secret/expiry here; AuthService always overrides per-call
    // so it can sign access vs. refresh tokens with different secrets.
    JwtModule.register({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: asDuration(env.JWT_ACCESS_EXPIRES_IN) },
    }),
    // Gifting spec Section 3/5: resolving a waiting Gift to the newly-
    // verified account, and flagging it on the session for the onboarding
    // carve-out.
    GiftsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
