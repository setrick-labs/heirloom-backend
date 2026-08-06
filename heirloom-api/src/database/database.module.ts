import { Global, Module } from '@nestjs/common';

import { db } from './connection';

export const DATABASE_CONNECTION = 'DATABASE_CONNECTION';

/** Global so feature modules can @Inject(DATABASE_CONNECTION) without re-importing this everywhere. */
@Global()
@Module({
  providers: [{ provide: DATABASE_CONNECTION, useValue: db }],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
