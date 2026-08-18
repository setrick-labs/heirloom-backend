import { ServiceUnavailableException } from '@nestjs/common';

import { HealthService } from './health.service';
import type { Database } from '../../database/connection';
import type { MailerService } from '../../shared/services/mailer.service';
import type { StorageService } from '../../shared/services/storage.service';

function build(options: {
  dbFails?: boolean;
  storageConfigured?: boolean;
  storageFails?: boolean;
  emailConfigured?: boolean;
}) {
  const db = {
    execute: jest.fn(async () => {
      if (options.dbFails) throw new Error('connection refused');
      return undefined;
    }),
  } as unknown as Database;

  const storage = {
    get isConfigured() {
      return options.storageConfigured ?? true;
    },
    checkConnection: jest.fn(async () => {
      if (options.storageFails) throw new Error('bucket not found');
    }),
  } as unknown as StorageService;

  const mailer = {
    get isConfigured() {
      return options.emailConfigured ?? true;
    },
  } as unknown as MailerService;

  return { service: new HealthService(db, storage, mailer), db, storage };
}

describe('HealthService.live — liveness', () => {
  it('answers without touching any dependency', () => {
    const { service, db, storage } = build({ dbFails: true, storageFails: true });

    const result = service.live();

    expect(result.status).toBe('alive');
    // The whole point: a liveness probe that consults the database would have
    // the orchestrator restart a healthy container over a database blip,
    // which cannot fix a database and turns an outage into a restart loop.
    expect(db.execute).not.toHaveBeenCalled();
    expect(storage.checkConnection).not.toHaveBeenCalled();
  });
});

describe('HealthService.check — readiness', () => {
  it('reports ok with every dependency healthy', async () => {
    const { service } = build({});
    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.checks.database.status).toBe('ok');
    expect(result.checks.storage.status).toBe('ok');
    expect(result.checks.email.status).toBe('ok');
  });

  it('keeps the legacy top-level fields, so existing monitors keep working', async () => {
    const { service } = build({});
    const result = await service.check();

    // These two predate the `checks` object and are what the e2e test and any
    // external monitor already read. Adding detail must not rename them.
    expect(result.status).toBe('ok');
    expect(result.database).toBe('ok');
    expect(typeof result.uptimeSeconds).toBe('number');
    expect(typeof result.timestamp).toBe('string');
  });

  it('throws 503 when the database is unreachable', async () => {
    const { service } = build({ dbFails: true });

    await expect(service.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.check()).rejects.toMatchObject({
      response: { code: 'DATABASE_UNAVAILABLE' },
    });
  });

  it('does not probe storage when the database has already failed', async () => {
    // A 503 shouldn't be delayed by waiting on services that can't rescue it.
    const { service, storage } = build({ dbFails: true });

    await expect(service.check()).rejects.toThrow();
    expect(storage.checkConnection).not.toHaveBeenCalled();
  });

  it('reports degraded — not down — when storage is broken', async () => {
    // Uploads break, but sign-in, journeys and reading existing content all
    // still work. Calling the whole API dead would describe reality worse.
    const { service } = build({ storageFails: true });
    const result = await service.check();

    expect(result.status).toBe('degraded');
    expect(result.checks.storage.status).toBe('error');
    expect(result.checks.storage.detail).toContain('bucket not found');
  });

  it('distinguishes "not set up" from "set up but broken"', async () => {
    const { service, storage } = build({
      storageConfigured: false,
      emailConfigured: false,
    });
    const result = await service.check();

    expect(result.checks.storage.status).toBe('unconfigured');
    expect(result.checks.email.status).toBe('unconfigured');
    // Unconfigured is incomplete, not failing — a dev box without S3 must not
    // page anyone, so it stays 'ok'.
    expect(result.status).toBe('ok');
    // And nothing is dialled when there's nothing configured to dial.
    expect(storage.checkConnection).not.toHaveBeenCalled();
  });

  it('never opens an SMTP connection — configuration is checked, not reachability', async () => {
    // Authenticating against the provider on every health poll is wasteful
    // and a good way to get rate-limited.
    const { service } = build({});
    const result = await service.check();
    expect(result.checks.email).toEqual({ status: 'ok' });
  });

  it('times each dependency it actually reaches', async () => {
    const { service } = build({});
    const result = await service.check();
    expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checks.storage.latencyMs).toBeGreaterThanOrEqual(0);
    // Email opens no connection, so it has nothing to time.
    expect(result.checks.email.latencyMs).toBeUndefined();
  });
});
