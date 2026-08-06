// Loaded here (not just via @nestjs/config) because `env` below is validated
// synchronously at import time — before Nest's own config loading would run.
import 'dotenv/config';
import { z } from 'zod';

// e.g. "15m", "1h", "30d" — matches the shape `jsonwebtoken`'s `expiresIn` expects.
const durationSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h|d|w|y)$/, 'must look like "15m", "1h", "30d", etc.');

/** `.env` leaves unset optional vars as "" rather than absent — treat "" as unset. */
function optionalString(inner: z.ZodString) {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    inner.optional(),
  );
}

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .url('DATABASE_URL must be a valid postgres connection string'),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: durationSchema.default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: durationSchema.default('30d'),

  CORS_ORIGIN: z.string().default('*'),

  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),

  // Cloudflare R2 (S3-compatible). Optional so the app can boot without them
  // configured yet; shared/services/storage.service.ts throws a clear error
  // if a caller actually tries to use storage while these are unset.
  R2_ACCOUNT_ID: optionalString(z.string().min(1)),
  R2_ACCESS_KEY_ID: optionalString(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: optionalString(z.string().min(1)),
  R2_BUCKET_NAME: optionalString(z.string().min(1)),
  R2_PUBLIC_URL: optionalString(z.string().url()),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Auth & family onboarding tuning (all flagged as judgment calls in the
  // functional spec — override freely, none of these are load-bearing
  // design decisions).
  ACCOUNT_VERIFICATION_CODE_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  FAMILY_INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  FAMILY_DELETION_GRACE_PERIOD_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  JOURNEY_DELETION_GRACE_PERIOD_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  LOGIN_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // Base URL used to build shareable family-invite links, e.g.
  // "https://heirloom.app/join" -> "https://heirloom.app/join?code=123456".
  // Optional: if unset, invite responses only include the raw code.
  INVITE_LINK_BASE_URL: optionalString(z.string().url()),
});

export type Env = z.infer<typeof envSchema>;

/** Also used as ConfigModule.forRoot's `validate` hook in app.module.ts — one schema, one error format. */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(
      `Invalid environment configuration — fix the following and restart:\n${issues}`,
    );
  }

  return result.data;
}

/** Validated once at module load (i.e. app boot); fails fast if anything is missing/invalid. */
export const env = validateEnv(process.env);
