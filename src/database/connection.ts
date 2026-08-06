import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { databaseConfig } from '../config/database.config';
import * as schema from './schema';

export const queryClient = postgres(databaseConfig.connectionString, {
  max: databaseConfig.max,
  ssl: databaseConfig.ssl,
});

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
