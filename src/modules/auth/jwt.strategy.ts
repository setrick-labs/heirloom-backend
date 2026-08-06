import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { eq } from 'drizzle-orm';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { users } from '../../database/schema';
import { AuthenticatedUser } from '../../shared/guards/current-user.decorator';

interface JwtPayload {
  sub: string;
  iat: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, payload.sub),
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.status === 'suspended') {
      throw new UnauthorizedException('This account has been suspended.');
    }
    // Makes password-reset session invalidation take effect immediately,
    // not just once the short-lived access token naturally expires.
    if (
      user.sessionsInvalidatedAt &&
      payload.iat * 1000 < user.sessionsInvalidatedAt.getTime()
    ) {
      throw new UnauthorizedException(
        'Session has been invalidated. Please sign in again.',
      );
    }

    return { id: user.id };
  }
}
