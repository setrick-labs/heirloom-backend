import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { users } from '../../database/schema';
import type { AuthenticatedUser } from '../../shared/guards/current-user.decorator';

interface VaultTokenPayload {
  sub: string;
  scope: 'vault';
  iat: number;
}

/**
 * Private Vault spec Section 1/8: "the Vault does not inherit trust from
 * the main app's sign-in state." JwtAuthGuard (applied globally) proves this
 * request belongs to a signed-in user; this guard additionally requires a
 * separate, short-lived vault token minted by /vault/unlock — a valid main
 * session alone is never enough to reach a vault content route.
 */
@Injectable()
export class VaultAccessGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: AuthenticatedUser;
      headers: Record<string, unknown>;
    }>();
    const authenticatedUser = request.user;
    const token = request.headers['x-vault-token'];

    if (!authenticatedUser || typeof token !== 'string' || !token) {
      throw new UnauthorizedException('The Vault is locked.');
    }

    let payload: VaultTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<VaultTokenPayload>(token, {
        secret: env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException(
        'Your Vault session has expired. Unlock it again.',
      );
    }

    if (payload.scope !== 'vault' || payload.sub !== authenticatedUser.id) {
      throw new UnauthorizedException('The Vault is locked.');
    }

    const user = await this.db.query.users.findFirst({
      where: eq(users.id, authenticatedUser.id),
    });
    if (
      user?.vaultSessionsInvalidatedAt &&
      payload.iat * 1000 < user.vaultSessionsInvalidatedAt.getTime()
    ) {
      throw new UnauthorizedException(
        'Your Vault session has expired. Unlock it again.',
      );
    }

    return true;
  }
}
