import type { PushDeepLink } from './push.service';

export interface PushContent {
  title: string;
  body: string;
  link: PushDeepLink;
}

/**
 * Copy for every push the app sends, and where each one lands.
 *
 * Kept beside the email templates and separate from transport for the same
 * reason: swapping push providers must never mean rewriting the words a
 * person reads on their lock screen.
 *
 * Two rules run through all of it. Notifications are written as a person
 * telling you something ("Maya added 3 photos"), never as the system
 * announcing itself. And nothing is quoted that the recipient could not
 * already see: the body may name the Journey and the actor, both of which
 * they have access to, but a comment's text is summarised rather than
 * reproduced, so a lock screen in a shared room does not become a leak.
 */

/** Lock-screen copy has to survive being truncated, so keep quoted content short. */
const MAX_QUOTE = 80;

function quote(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= MAX_QUOTE
    ? collapsed
    : `${collapsed.slice(0, MAX_QUOTE - 1)}…`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

export function buildNewMemoryPush(input: {
  actorName: string;
  journeyTitle: string;
  journeyId: string;
  milestoneId?: string | null;
  count: number;
}): PushContent {
  return {
    title: input.journeyTitle,
    body: `${input.actorName} added ${plural(input.count, 'memory', 'memories')}.`,
    // Straight to the stop when there is one — that is where the new photos
    // actually are. The journey is the fallback, never Home.
    link: input.milestoneId
      ? { path: `/milestone/${input.milestoneId}` }
      : { path: `/journey/${input.journeyId}` },
  };
}

export function buildCommentPush(input: {
  actorName: string;
  body: string;
  isReply: boolean;
  mediaId: string;
}): PushContent {
  return {
    title: input.isReply
      ? `${input.actorName} replied`
      : `${input.actorName} commented`,
    body: quote(input.body),
    link: { path: `/photo/${input.mediaId}` },
  };
}

/** A voice note has no text to quote — say what arrived instead of quoting silence. */
export function buildVoiceCommentPush(input: {
  actorName: string;
  isReply: boolean;
  mediaId: string;
}): PushContent {
  return {
    title: input.isReply
      ? `${input.actorName} replied`
      : `${input.actorName} commented`,
    body: 'Sent a voice note.',
    link: { path: `/photo/${input.mediaId}` },
  };
}

/** `commentTypeEnum`'s 'version' — someone's own take on a photo you posted. */
export function buildVersionPush(input: {
  actorName: string;
  mediaId: string;
}): PushContent {
  return {
    title: `${input.actorName} added their version`,
    body: 'Of one of your memories.',
    link: { path: `/photo/${input.mediaId}` },
  };
}

export function buildReactionPush(input: {
  actorName: string;
  emoji: string;
  mediaId: string;
}): PushContent {
  return {
    title: `${input.actorName} reacted ${input.emoji}`,
    body: 'On one of your memories.',
    link: { path: `/photo/${input.mediaId}` },
  };
}

export function buildFamilyJoinPush(input: {
  actorName: string;
  familyName: string;
  familyId: string;
}): PushContent {
  return {
    title: input.familyName,
    body: `${input.actorName} joined the family.`,
    link: { path: '/family', params: { familyId: input.familyId } },
  };
}

/** Section 4's reveal, as a push rather than an email — the recipient has the app. */
export function buildGiftUnlockedPush(input: {
  senderName: string;
  journeyTitle: string;
  giftId: string;
}): PushContent {
  return {
    title: 'A gift has opened',
    body: `${input.senderName} made "${input.journeyTitle}" for you.`,
    link: { path: `/gift/${input.giftId}/reveal` },
  };
}

/**
 * Shared Vault pushes. They name the vault — every recipient is a member who
 * can already see that name — but never what's inside it: a notification
 * banner is readable on a locked phone, and a caption there would be exactly
 * the leak the vault's passcode exists to prevent.
 */
export function buildSharedVaultInvitePush(input: {
  actorName: string;
  vaultName: string;
  vaultId: string;
}): PushContent {
  return {
    title: 'Shared vault invitation',
    body: `${input.actorName} invited you to "${input.vaultName}".`,
    link: { path: `/shared-vault/${input.vaultId}` },
  };
}

export function buildSharedVaultDeletionRequestPush(input: {
  actorName: string;
  vaultName: string;
  vaultId: string;
  wholeVault: boolean;
}): PushContent {
  return {
    title: input.vaultName,
    body: input.wholeVault
      ? `${input.actorName} wants to delete this shared vault. Nothing is removed unless everyone agrees.`
      : `${input.actorName} wants to delete a memory. Nothing is removed unless everyone agrees.`,
    link: { path: `/shared-vault/${input.vaultId}/requests` },
  };
}

export function buildSharedVaultDeletionResultPush(input: {
  vaultName: string;
  vaultId: string;
  outcome: 'approved' | 'declined' | 'expired';
  wholeVault: boolean;
}): PushContent {
  const what = input.wholeVault ? 'the vault' : 'that memory';
  const body =
    input.outcome === 'approved'
      ? `Everyone agreed — ${what} has been deleted.`
      : input.outcome === 'declined'
        ? `Someone chose to keep ${what}, so nothing was deleted.`
        : `Not everyone answered in time, so ${what} was kept.`;
  return {
    title: input.vaultName,
    body,
    link: { path: input.wholeVault && input.outcome === 'approved' ? '/vault' : `/shared-vault/${input.vaultId}` },
  };
}
