import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { env, validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommentsModule } from './modules/comments/comments.module';
import { FamiliesModule } from './modules/families/families.module';
import { GiftsModule } from './modules/gifts/gifts.module';
import { HealthModule } from './modules/health/health.module';
import { JourneysModule } from './modules/journeys/journeys.module';
import { MediaModule } from './modules/media/media.module';
import { MilestonesModule } from './modules/milestones/milestones.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { UsersModule } from './modules/users/users.module';
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
            ? { target: 'pino-pretty' }
            : undefined,
        autoLogging: true,
      },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT },
    ]),
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
    GiftsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
