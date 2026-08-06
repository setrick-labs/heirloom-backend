import { pgEnum } from 'drizzle-orm/pg-core';

/** A user's standing within a family (mirrors the mobile app's UserRole). */
export const familyRoleEnum = pgEnum('family_role', [
  'owner',
  'admin',
  'member',
  'viewer',
]);

/**
 * Account lifecycle state. 'pending' = signed up but not yet verified
 * (email/phone); accounts stay pending indefinitely if abandoned, never
 * auto-delete. 'suspended' has no admin tooling to set it yet — the state
 * exists so sign-in can handle it defensively per the auth functional spec.
 */
export const userStatusEnum = pgEnum('user_status', [
  'pending',
  'active',
  'suspended',
]);

/** What an auth_tokens row is for — one table backs both flows since both are "single-use, time-limited, delivered out of band". */
export const authTokenTypeEnum = pgEnum('auth_token_type', [
  'account_verification',
  'password_reset',
]);

/** Whether a journey is visible to the whole family or only journey_members. */
export const journeyVisibilityEnum = pgEnum('journey_visibility', [
  'all',
  'selected',
]);

export const mediaTypeEnum = pgEnum('media_type', ['image', 'video', 'audio']);

/**
 * Polymorphic target kind for comments/reactions. `moment` and `event` don't
 * have their own tables (they're computed views over media/milestones), but
 * the tag is kept here so comments/reactions can still reference them.
 */
export const contentTargetTypeEnum = pgEnum('content_target_type', [
  'milestone',
  'media',
  'moment',
  'event',
]);

/** A comment's own content kind — 'version' is how "add your version" reuses this table. */
export const commentTypeEnum = pgEnum('comment_type', [
  'text',
  'voice',
  'sticker',
  'version',
]);
