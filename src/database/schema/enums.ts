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
 * Tracks the async variant/blurhash pass (see MediaProcessingService).
 * Null for non-image media, which is never processed. Set to 'pending' at
 * insert time — before the fire-and-forget pass even starts — so a crash
 * mid-processing leaves a visibly stuck row instead of one indistinguishable
 * from "not applicable"; scripts/retry-failed-media.ts queries for both
 * 'failed' and long-stuck 'pending' rows.
 */
export const mediaProcessingStatusEnum = pgEnum('media_processing_status', [
  'pending',
  'done',
  'failed',
]);

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

/**
 * What a content_views row tracks. Deliberately narrower than
 * contentTargetTypeEnum above: read state is only ever recorded for the two
 * surfaces the flow puts an unread badge on — a Journey card on Home
 * (Screen 17) and a Milestone card in the timeline (Screen 20) — not for
 * individual media or comments.
 */
export const viewTargetTypeEnum = pgEnum('view_target_type', [
  'journey',
  'milestone',
]);

/** A comment's own content kind — 'version' is how "add your version" reuses this table. */
export const commentTypeEnum = pgEnum('comment_type', [
  'text',
  'voice',
  'sticker',
  'version',
]);
