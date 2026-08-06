import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
  });

  await app.listen(env.PORT);
}

void bootstrap();
