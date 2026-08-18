import { env } from './env';

function requireTls(): boolean {
  if (env.DATABASE_SSL !== undefined) return env.DATABASE_SSL;
  return env.NODE_ENV === 'production';
}

export const databaseConfig = {
  connectionString: env.DATABASE_URL,
  // Small pool for local dev; give production more headroom.
  max: env.NODE_ENV === 'production' ? 20 : 5,
  // Explicit setting wins; otherwise default to requiring TLS in production.
  // See DATABASE_SSL in env.ts for why this isn't keyed to NODE_ENV alone.
  ssl: requireTls() ? ('require' as const) : false,
} as const;
