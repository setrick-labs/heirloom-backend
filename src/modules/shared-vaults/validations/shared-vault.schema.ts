import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';
import {
  mediaSchema,
  mediaTypeSchema,
} from '../../media/validations/media.schema';
import { MAX_SHARED_VAULT_MEMBERS } from '../shared-vault-policy';

/** Same shape as the personal Vault's passcode — see vault.schema.ts. */
const passcodeSchema = z.string().min(4).max(72);

const nameSchema = z.string().trim().min(1).max(80);

export const sharedVaultMemberSchema = z.object({
  userId: idSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['owner', 'member']),
  status: z.enum(['invited', 'active']),
});
export type SharedVaultMember = z.infer<typeof sharedVaultMemberSchema>;

/**
 * What the list shows before anything is unlocked: who's in it and how
 * much is there, never what. No thumbnails — a cover photo on a locked
 * vault would be the very thing the lock is for.
 */
export const sharedVaultSummarySchema = z.object({
  id: idSchema,
  familyId: idSchema,
  name: z.string(),
  /** The caller's own standing in this vault. */
  myRole: z.enum(['owner', 'member']),
  myStatus: z.enum(['invited', 'active']),
  invitedByName: z.string().nullable(),
  members: z.array(sharedVaultMemberSchema),
  itemCount: z.number().int().nonnegative(),
  /** Deletion requests still waiting on the caller's answer. */
  awaitingMyVote: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
});
export type SharedVaultSummary = z.infer<typeof sharedVaultSummarySchema>;

export const sharedVaultSessionSchema = z.object({
  vaultToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type SharedVaultSession = z.infer<typeof sharedVaultSessionSchema>;

export const createSharedVaultInputSchema = z.object({
  familyId: idSchema,
  name: nameSchema,
  /** Everyone to invite, not counting the creator. */
  memberIds: z
    .array(idSchema)
    .min(1, 'Choose at least one person to share with')
    .max(MAX_SHARED_VAULT_MEMBERS - 1),
  passcode: passcodeSchema,
});
export type CreateSharedVaultInput = z.infer<
  typeof createSharedVaultInputSchema
>;

export const inviteSharedVaultMembersInputSchema = z.object({
  memberIds: z.array(idSchema).min(1).max(MAX_SHARED_VAULT_MEMBERS - 1),
});
export type InviteSharedVaultMembersInput = z.infer<
  typeof inviteSharedVaultMembersInputSchema
>;

export const acceptSharedVaultInputSchema = z.object({
  passcode: passcodeSchema,
});
export type AcceptSharedVaultInput = z.infer<
  typeof acceptSharedVaultInputSchema
>;

export const unlockSharedVaultInputSchema = z.object({
  passcode: passcodeSchema,
});
export type UnlockSharedVaultInput = z.infer<
  typeof unlockSharedVaultInputSchema
>;

export const changeSharedVaultPasscodeInputSchema = z.object({
  currentPasscode: passcodeSchema,
  newPasscode: passcodeSchema,
});
export type ChangeSharedVaultPasscodeInput = z.infer<
  typeof changeSharedVaultPasscodeInputSchema
>;

/** Forgotten passcode: re-prove the account, same trade-off as the personal Vault. */
export const recoverSharedVaultInputSchema = z.object({
  accountPassword: z.string().min(1),
  newPasscode: passcodeSchema,
});
export type RecoverSharedVaultInput = z.infer<
  typeof recoverSharedVaultInputSchema
>;

export const renameSharedVaultInputSchema = z.object({ name: nameSchema });
export type RenameSharedVaultInput = z.infer<
  typeof renameSharedVaultInputSchema
>;

export const requestSharedVaultUploadUrlInputSchema = z.object({
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type RequestSharedVaultUploadUrlInput = z.infer<
  typeof requestSharedVaultUploadUrlInputSchema
>;

export const createSharedVaultItemInputSchema = z.object({
  type: mediaTypeSchema,
  key: z.string().min(1),
  caption: mediaSchema.shape.caption,
  sizeBytes: mediaSchema.shape.sizeBytes,
});
export type CreateSharedVaultItemInput = z.infer<
  typeof createSharedVaultItemInputSchema
>;

export const deletionRequestSchema = z.object({
  id: idSchema,
  /** Null when the request is to delete the whole vault. */
  itemId: idSchema.nullable(),
  requestedBy: idSchema,
  requestedByName: z.string(),
  status: z.enum(['pending', 'approved', 'declined', 'cancelled', 'expired']),
  /** Everyone whose yes is still needed or already given. */
  approverIds: z.array(idSchema),
  approvedBy: z.array(idSchema),
  myVote: z.enum(['approve', 'decline']).nullable(),
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;

export const sharedVaultItemSchema = z.object({
  id: idSchema,
  type: mediaTypeSchema,
  url: z.url(),
  caption: mediaSchema.shape.caption,
  sizeBytes: mediaSchema.shape.sizeBytes,
  uploaderId: idSchema.nullable(),
  /** Until this passes, the uploader can delete it alone. */
  undoUntil: isoDateTimeSchema,
  /** The live deletion request against this item, if any. */
  pendingDeletion: deletionRequestSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type SharedVaultItem = z.infer<typeof sharedVaultItemSchema>;

/** What a delete call did: gone at once, or waiting on everyone else. */
export const deletionResultSchema = z.object({
  deleted: z.boolean(),
  request: deletionRequestSchema.nullable(),
});
export type DeletionResult = z.infer<typeof deletionResultSchema>;
