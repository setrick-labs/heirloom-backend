import { env } from './env';

export const databaseConfig = {
  connectionString: env.DATABASE_URL,
  // Small pool for local dev; give production more headroom.
  max: env.NODE_ENV === 'production' ? 20 : 5,
  ssl: env.NODE_ENV === 'production' ? ('require' as const) : false,
} as const;
