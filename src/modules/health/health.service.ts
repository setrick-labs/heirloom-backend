import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { MailerService } from '../../shared/services/mailer.service';
import { StorageService } from '../../shared/services/storage.service';

export type CheckState = 'ok' | 'error' | 'unconfigured';

export interface DependencyCheck {
  status: CheckState;
  /** Round trip in milliseconds, when the check actually reached something. */
  latencyMs?: number;
  /** Why it failed. Only present on 'error'. */
  detail?: string;
}

export interface HealthStatus {
  /**
   * 'ok' when everything the API needs is working, 'degraded' when a
   * non-critical dependency is down.
   *
   * Kept at the top level, alongside `database`, because monitors and the
   * existing e2e test read these two fields — the richer `checks` object
   * below is additive so nothing that already polls this breaks.
   */
  status: 'ok' | 'degraded';
  database: 'ok';
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: DependencyCheck;
    storage: DependencyCheck;
    email: DependencyCheck;
  };
}

export interface LivenessStatus {
  status: 'alive';
  uptimeSeconds: number;
  timestamp: string;
}

async function timed(probe: () => Promise<unknown>): Promise<DependencyCheck> {
  const started = Date.now();
  try {
    await probe();
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : 'Check failed',
    };
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Liveness: is this process running and able to answer?
   *
   * Deliberately checks nothing else. A liveness probe that fails when the
   * database blips would have the orchestrator restart a perfectly healthy
   * container — which cannot fix a database and turns a brief outage into a
   * restart loop. Point container healthchecks here; point uptime monitoring
   * at `check()` below.
   */
  live(): LivenessStatus {
    return {
      status: 'alive',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: can this instance actually serve requests?
   *
   * The database is the only hard dependency — without it essentially every
   * endpoint fails, so its loss is a 503. Storage and email are reported but
   * do not fail the check: if object storage is down, uploads break while
   * sign-in, journeys, and reading existing content all still work, and
   * declaring the whole API dead would be a worse description of reality
   * than 'degraded'.
   */
  async check(): Promise<HealthStatus> {
    const database = await timed(() => this.db.execute(sql`select 1`));

    if (database.status !== 'ok') {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: database.detail ?? 'Database connectivity check failed',
      });
    }

    // Both run only after the database passes, so a 503 isn't delayed by
    // waiting on services that can't rescue it anyway.
    const [storage, email] = await Promise.all([
      this.checkStorage(),
      Promise.resolve(this.checkEmail()),
    ]);

    const degraded = storage.status === 'error' || email.status === 'error';

    return {
      status: degraded ? 'degraded' : 'ok',
      database: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database, storage, email },
    };
  }

  /**
   * HeadBucket — proves credentials, endpoint and bucket name are all right
   * without touching an object. Unconfigured is reported as its own state
   * rather than an error: a deployment without S3 set up yet is incomplete,
   * not broken, and saying so is more useful than a misleading failure.
   */
  private async checkStorage(): Promise<DependencyCheck> {
    if (!this.storage.isConfigured) return { status: 'unconfigured' };
    return timed(() => this.storage.checkConnection());
  }

  /**
   * Configuration only — no connection is opened. Reaching out to the SMTP
   * server on every health poll would authenticate against the provider
   * continuously, which is both wasteful and a good way to get rate-limited.
   */
  private checkEmail(): DependencyCheck {
    return this.mailer.isConfigured
      ? { status: 'ok' }
      : { status: 'unconfigured' };
  }
}
