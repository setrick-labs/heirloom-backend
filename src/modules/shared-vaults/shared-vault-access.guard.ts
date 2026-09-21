import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { sharedVaultMembers } from '../../database/schema';
import type { AuthenticatedUser } from '../../shared/guards/current-user.decorator';

interface SharedVaultTokenPayload {
  sub: string;
  scope: 'shared-vault';
  vid: string;
  iat: number;
}

/**
 * The shared-vault twin of VaultAccessGuard: a signed-in session is never
 * enough on its own. The `X-Shared-Vault-Token` must have been minted by
 * this member's own unlock *for the vault in the URL* — a token for one
 * shared vault opens that one and nothing else — and must post-date their
 * last passcode change.
 */
@Injectable()
export class SharedVaultAccessGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: AuthenticatedUser;
      headers: Record<string, unknown>;
      params: Record<string, string>;
    }>();
    const user = request.user;
    const token = request.headers['x-shared-vault-token'];
    const vaultId = request.params.id;

    if (!user || typeof token !== 'string' || !token || !vaultId) {
      throw new UnauthorizedException('This vault is locked.');
    }

    let payload: SharedVaultTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<SharedVaultTokenPayload>(token, {
        secret: env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Your vault session has expired. Unlock it again.');
    }

    if (
      payload.scope !== 'shared-vault' ||
      payload.sub !== user.id ||
      payload.vid !== vaultId
    ) {
      throw new UnauthorizedException('This vault is locked.');
    }

    const member = await this.db.query.sharedVaultMembers.findFirst({
      where: and(
        eq(sharedVaultMembers.vaultId, vaultId),
        eq(sharedVaultMembers.userId, user.id),
      ),
    });
    if (!member || member.status !== 'active') {
      throw new UnauthorizedException('This vault is locked.');
    }
    if (
      member.sessionsInvalidatedAt &&
      payload.iat * 1000 < member.sessionsInvalidatedAt.getTime()
    ) {
      throw new UnauthorizedException('Your vault session has expired. Unlock it again.');
    }
    // Family membership is re-checked by the service on every call.
    return true;
  }
}
