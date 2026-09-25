import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { eq } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { users } from '../../database/schema';

interface AccessTokenPayload {
  sub: string;
  iat: number;
}

/**
 * Live delivery for two things: the notification bell (`notification:new`,
 * to whoever the notification is for) and "someone just commented/reacted
 * on the thing you have open" (`activity:new`, to whoever is currently
 * looking at that target).
 *
 * This is new infrastructure the team's own decision doc
 * (docs/decisions/realtime-comments.md) had deliberately deferred — polling
 * plus push covered the realistic cases. Reinstated here at the user's
 * request as a second delivery path for the foregrounded case specifically;
 * push (already live via OneSignal) still owns the backgrounded case, and
 * `staleTime: 0` + focus-refetch on comments/reactions stays in place as the
 * fallback if a socket is ever disconnected.
 *
 * Single NestJS instance today (no Redis, no broker — see the decision doc),
 * so an in-memory Socket.IO server is enough: every connection lands on the
 * same process, and rooms behave correctly with zero extra infrastructure.
 * The moment this runs on more than one instance, events stop reaching
 * sockets connected to a different process — that's the point at which a
 * Socket.IO Redis adapter (`@socket.io/redis-adapter`) becomes required, not
 * optional. Flagged here so it isn't forgotten, not built now.
 */
@Injectable()
@WebSocketGateway({
  cors: {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
  },
})
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
  ) {}

  /**
   * Auth on connect, not per-message — this is a small hand-rolled check
   * rather than reusing JwtAuthGuard, which is built for Passport's HTTP
   * request lifecycle and doesn't attach to a socket handshake. Mirrors
   * JwtStrategy.validate's two checks (real, non-suspended user; not
   * signed out from under itself by a password reset) against the same
   * access-token secret every REST call already trusts.
   */
  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No access token on handshake');

      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: env.JWT_ACCESS_SECRET },
      );
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, payload.sub),
      });
      if (!user || user.status === 'suspended') {
        throw new Error('Invalid or suspended account');
      }
      if (
        user.sessionsInvalidatedAt &&
        payload.iat * 1000 < user.sessionsInvalidatedAt.getTime()
      ) {
        throw new Error('Session has been invalidated');
      }

      socket.data.userId = user.id;
      await socket.join(userRoom(user.id));
      // Joins sent before this point are dropped by onJoin (no userId yet),
      // and a client connects — and flushes its queued joins — before this
      // async check finishes. `ready` tells it when to (re)send them.
      socket.emit('ready');
    } catch (error) {
      this.logger.warn(`Rejected socket connection: ${error}`);
      socket.disconnect(true);
    }
  }

  /**
   * A client joins a target's room only while it actually has that target
   * open (the Photo Detail screen, on mount) — never subscribed to every
   * target by default, which would mean broadcasting every comment/reaction
   * in the app to every connected client.
   */
  @SubscribeMessage('join')
  onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { targetType?: string; targetId?: string },
  ): void {
    if (!socket.data.userId || !body?.targetType || !body?.targetId) return;
    void socket.join(targetRoom(body.targetType, body.targetId));
  }

  @SubscribeMessage('leave')
  onLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { targetType?: string; targetId?: string },
  ): void {
    if (!body?.targetType || !body?.targetId) return;
    void socket.leave(targetRoom(body.targetType, body.targetId));
  }

  /** For the bell/badge — one recipient. */
  emitNotification(recipientId: string, notification: unknown): void {
    this.server?.to(userRoom(recipientId)).emit('notification:new', notification);
  }

  /** For whoever currently has this target open — see `join` above. */
  emitActivity(targetType: string, targetId: string): void {
    this.server
      ?.to(targetRoom(targetType, targetId))
      .emit('activity:new', { targetType, targetId });
  }
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function targetRoom(targetType: string, targetId: string): string {
  return `target:${targetType}:${targetId}`;
}
