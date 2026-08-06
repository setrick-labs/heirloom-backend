import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';
import {
  mediaSchema,
  mediaTypeSchema,
} from '../../media/validations/media.schema';

// Same length rule as the account password (auth.schema.ts's signUpInputSchema).
const vaultPasswordSchema = z.string().min(8).max(72);

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

/** Section 6: forgotten vault password, recovered via account-level re-authentication. */
export const recoverVaultInputSchema = z.object({
  accountPassword: z.string().min(1),
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
  url: z.url(),
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
