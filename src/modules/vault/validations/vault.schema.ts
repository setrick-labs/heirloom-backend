import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';
import {
  mediaSchema,
  mediaTypeSchema,
} from '../../media/validations/media.schema';

/**
 * Deliberately NOT the account-password rule.
 *
 * The Vault is unlocked from a passcode pad on a phone you are already
 * holding and already signed in on (Screens 33/46), so the threat it defends
 * against is someone picking up an unlocked device — not an offline attack on
 * a stolen hash. A 4-digit passcode is the right shape for that, and what
 * makes it safe is the server-side lockout rather than the length: see
 * VAULT_LOCKOUT_MAX_ATTEMPTS / VAULT_LOCKOUT_MINUTES, which were tuned for
 * exactly this loop.
 *
 * Longer is still allowed, so a passphrase works for anyone who wants one.
 */
const vaultPasswordSchema = z.string().min(4).max(72);

export const vaultStatusSchema = z.object({
  isSetUp: z.boolean(),
});
export type VaultStatus = z.infer<typeof vaultStatusSchema>;

export const setupVaultInputSchema = z.object({
  password: vaultPasswordSchema,
});
export type SetupVaultInput = z.infer<typeof setupVaultInputSchema>;

export const unlockVaultInputSchema = z.object({
  password: vaultPasswordSchema,
});
export type UnlockVaultInput = z.infer<typeof unlockVaultInputSchema>;

/**
 * Section 6: forgotten vault password — two factors. Step 1 proves the
 * account password and emails a code; step 2 proves the inbox. The account
 * password alone is not enough: the Vault exists to keep out someone holding
 * your unlocked phone, and that phone often has the password saved.
 */
export const startVaultRecoveryInputSchema = z.object({
  accountPassword: z.string().min(1),
});
export type StartVaultRecoveryInput = z.infer<
  typeof startVaultRecoveryInputSchema
>;

export const vaultRecoveryStartedSchema = z.object({
  /** Masked, e.g. "a***@gmail.com" — enough to know which inbox to open. */
  sentTo: z.string(),
  expiresInMinutes: z.number().int().positive(),
});
export type VaultRecoveryStarted = z.infer<typeof vaultRecoveryStartedSchema>;

export const recoverVaultInputSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/, 'Enter the 6-digit code'),
  newVaultPassword: vaultPasswordSchema,
});
export type RecoverVaultInput = z.infer<typeof recoverVaultInputSchema>;

export const vaultSessionSchema = z.object({
  vaultToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type VaultSession = z.infer<typeof vaultSessionSchema>;

export const requestVaultUploadUrlInputSchema = z.object({
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type RequestVaultUploadUrlInput = z.infer<
  typeof requestVaultUploadUrlInputSchema
>;

export const vaultItemSchema = z.object({
  id: idSchema,
  type: mediaTypeSchema,
  /** Display variant (streaming MP4 for a video), else the original. */
  url: z.url(),
  // Same meaning as on a family memory — see media.schema.ts.
  thumbnailUrl: mediaSchema.shape.thumbnailUrl,
  zoomUrl: mediaSchema.shape.zoomUrl,
  posterUrl: mediaSchema.shape.posterUrl,
  blurhash: mediaSchema.shape.blurhash,
  width: mediaSchema.shape.width,
  height: mediaSchema.shape.height,
  durationSeconds: mediaSchema.shape.durationSeconds,
  caption: mediaSchema.shape.caption,
  sizeBytes: mediaSchema.shape.sizeBytes,
  createdAt: isoDateTimeSchema,
});
export type VaultItem = z.infer<typeof vaultItemSchema>;

export const createVaultItemInputSchema = z.object({
  type: mediaTypeSchema,
  key: z.string().min(1),
  caption: mediaSchema.shape.caption,
  sizeBytes: mediaSchema.shape.sizeBytes,
});
export type CreateVaultItemInput = z.infer<typeof createVaultItemInputSchema>;

/** Vault → Milestone: see VaultService.moveToMilestone. */
export const moveVaultItemToMilestoneInputSchema = z.object({
  milestoneId: idSchema,
});
export type MoveVaultItemToMilestoneInput = z.infer<
  typeof moveVaultItemToMilestoneInputSchema
>;
