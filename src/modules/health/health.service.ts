import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';

export interface HealthStatus {
  status: 'ok';
  database: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async check(): Promise<HealthStatus> {
    try {
      await this.db.execute(sql`select 1`);
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message:
          error instanceof Error
            ? error.message
            : 'Database connectivity check failed',
      });
    }

    return {
      status: 'ok',
      database: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
