import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { env, validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommentsModule } from './modules/comments/comments.module';
import { FamiliesModule } from './modules/families/families.module';
import { GiftsModule } from './modules/gifts/gifts.module';
import { HealthModule } from './modules/health/health.module';
import { RootModule } from './modules/root/root.module';
import { JourneysModule } from './modules/journeys/journeys.module';
import { MediaModule } from './modules/media/media.module';
import { MilestonesModule } from './modules/milestones/milestones.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { SearchModule } from './modules/search/search.module';
import { UsersModule } from './modules/users/users.module';
import { VaultModule } from './modules/vault/vault.module';
import { ViewsModule } from './modules/views/views.module';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    // Reuses config/env.ts's Zod schema so @nestjs/config and our `env`
    // singleton can never validate two different things.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        transport:
          env.NODE_ENV === 'development'
            ? {
                target: 'pino-pretty',
                // Only the message line (method + path + status) — the full
                // req/res objects (headers, IP, etc.) are noise for local dev.
                options: {
                  singleLine: true,
                  ignore: 'pid,hostname,req,res,context,responseTime',
                },
              }
            : undefined,
        autoLogging: true,
        // Trims what's actually attached to the log record, not just what
        // pino-pretty displays — keeps production JSON logs minimal too.
        serializers: {
          req: (req) => ({ method: req.method, url: req.url }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        customSuccessMessage: (req, res) =>
          `${req.method} ${req.url} -> ${res.statusCode}`,
        customErrorMessage: (req, res, err) =>
          `${req.method} ${req.url} -> ${res.statusCode} (${err.message})`,
      },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT },
    ]),
    // Drives GiftsService's unlock sweep (Gifting spec Section 3).
    ScheduleModule.forRoot(),
    DatabaseModule,
    SharedModule,
    AuthModule,
    UsersModule,
    FamiliesModule,
    JourneysModule,
    MilestonesModule,
    MediaModule,
    CommentsModule,
    ReactionsModule,
    SearchModule,
    VaultModule,
    GiftsModule,
    ViewsModule,
    HealthModule,
    RootModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
