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

/** Plain z.coerce.boolean() would treat the string "false" as true — this only ever reads it as literally "true". */
function booleanString(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === '' || value === undefined) return defaultValue;
    return value === 'true';
  }, z.boolean());
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

  // Object storage — any S3-compatible service (Cloudflare R2 in production;
  // a self-hosted SeaweedFS S3 gateway, MinIO, etc. for local/dev use before
  // R2 is set up). Named to match the standard AWS SDK env vars
  // (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION) rather than a
  // provider-specific prefix, since the same client works against any of
  // them — only S3_ENDPOINT changes between providers. Optional so the app
  // can boot without them configured yet; shared/services/storage.service.ts
  // throws a clear error if a caller actually tries to use storage while
  // these are unset.
  AWS_ACCESS_KEY_ID: optionalString(z.string().min(1)),
  AWS_SECRET_ACCESS_KEY: optionalString(z.string().min(1)),
  // R2/SeaweedFS/MinIO all accept 'auto' and ignore it; a real AWS S3 bucket
  // needs its actual region (e.g. 'us-east-1').
  AWS_REGION: z.string().min(1).default('auto'),
  // Explicit endpoint — required for R2 and any self-hosted service (e.g.
  // "https://{accountId}.r2.cloudflarestorage.com" for R2, or
  // "https://your-seaweedfs-host" for SeaweedFS). Leave unset only for real
  // AWS S3, which resolves its own endpoint from AWS_REGION.
  S3_ENDPOINT: optionalString(z.string().url()),
  // SeaweedFS/MinIO typically need path-style URLs (host/bucket/key) rather
  // than virtual-hosted style (bucket.host/key). Leave false for R2 or real
  // AWS S3; set true for SeaweedFS.
  S3_FORCE_PATH_STYLE: booleanString(false),
  S3_BUCKET_NAME: optionalString(z.string().min(1)),

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
  MILESTONE_DELETION_GRACE_PERIOD_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  // Private Vault spec Section 1: "a short grace window" — how long a
  // vault-unlock session stays valid before the app has to re-prompt.
  VAULT_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  LOGIN_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  // Vault unlock throttling, separate from the sign-in numbers above:
  // flow Screen 46 shows "2 attempts left" and a short "try again in 1
  // minute" lockout, which is a tighter, more forgiving loop than an
  // account lockout — a wrong passcode on your own phone is usually a
  // typo, and it must never lock you out of the whole account.
  VAULT_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  VAULT_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(1),

  // Outbound email (SMTP). Optional as a group: with SMTP_HOST unset the
  // NotificationService logs what it would have sent instead of failing, so
  // the whole auth flow stays testable locally without a mail provider.
  // Deliberately plain SMTP rather than a vendor SDK — every provider
  // (Resend, Postmark, SES, Mailgun, a self-hosted relay) speaks it, so
  // switching is a config change rather than a code change.
  SMTP_HOST: optionalString(z.string().min(1)),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString(z.string().min(1)),
  SMTP_PASSWORD: optionalString(z.string().min(1)),
  // True for implicit TLS on port 465; false for STARTTLS on 587.
  SMTP_SECURE: booleanString(false),
  // The From: header. Must be an address the SMTP account is allowed to send
  // as, or most providers will reject the message outright.
  MAIL_FROM: optionalString(z.string().min(1)),

  // Base URL for links the app deep-links back into — gift invites
  // (Screen 40's "See Your Gift" CTA) build on this. Optional: without it
  // the email still explains the gift, it just can't offer a one-tap link.
  APP_LINK_BASE_URL: optionalString(z.string().url()),

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
