import { Injectable, Logger } from '@nestjs/common';

import { env } from '../../config/env';

/** What the app does when the notification is tapped. See the frontend's push router. */
export interface PushDeepLink {
  /** An expo-router pathname, e.g. `/journey/abc`. */
  path: string;
  /** Anything else the destination screen needs. */
  params?: Record<string, string>;
}

export interface OutboundPush {
  /** OneSignal external ids — our own user UUIDs. See the note on aliases below. */
  userIds: string[];
  title: string;
  body: string;
  link?: PushDeepLink;
  /**
   * Notifications sharing this id replace one another on the device instead
   * of stacking.
   *
   * This is what keeps a ten-photo upload from becoming ten lock-screen
   * rows: each new memory notification for the same journey and the same
   * uploader supersedes the last, and the copy counts what has arrived so
   * far ("Maya added 4 memories"). Without it the only alternatives are
   * spamming or holding events in a queue nothing else in this app needs.
   */
  collapseId?: string;
  /** What to call this message in the logs. Never log the body: it quotes user content. */
  logLabel: string;
}

const ONESIGNAL_API = 'https://api.onesignal.com/notifications';

/** A single request may name at most this many aliases; longer lists are chunked. */
const MAX_ALIASES_PER_REQUEST = 2_000;

/** A push is never worth holding a request open for. */
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * The one place a push notification actually leaves the process.
 *
 * Split from NotificationService for the same reason MailerService is: that
 * service stays about *what* gets sent and to whom, this one stays about
 * transport.
 *
 * Users are addressed by **external id** — the OneSignal alias set to our own
 * `users.id` when the app signs in — rather than by device/subscription id.
 * That is what lets this server target a person without storing push tokens
 * at all: no device table to keep, no stale-token cleanup, and someone signed
 * in on a phone and a tablet is one target that reaches both. OneSignal owns
 * the device list; we own the identity.
 *
 * When ONESIGNAL_APP_ID/ONESIGNAL_REST_API_KEY are unset this logs the
 * message instead of sending it — a deliberate, supported mode, exactly as
 * with SMTP. Every trigger below stays exercisable locally with no OneSignal
 * account and no device.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  get isConfigured(): boolean {
    return Boolean(env.ONESIGNAL_APP_ID && env.ONESIGNAL_REST_API_KEY);
  }

  /**
   * Never throws. Same contract as MailerService.send, for the same reason:
   * every caller is a write that has already committed — the comment exists,
   * the gift has unlocked — so a delivery failure must degrade to "no
   * notification arrived", never to a 500 on work that actually succeeded.
   *
   * Returns whether anything was handed to OneSignal, for callers that want
   * to log it. Nobody should branch on it to retry: a push is worth sending
   * once, at the moment it is relevant, or not at all.
   */
  async send(push: OutboundPush): Promise<boolean> {
    const recipients = [...new Set(push.userIds)].filter(Boolean);
    if (recipients.length === 0) return false;

    if (!this.isConfigured) {
      this.logger.warn(
        `[push NOT sent — OneSignal not configured] ${push.logLabel} to ${recipients.length} user(s): ${push.title}`,
      );
      return false;
    }

    const batches: string[][] = [];
    for (let i = 0; i < recipients.length; i += MAX_ALIASES_PER_REQUEST) {
      batches.push(recipients.slice(i, i + MAX_ALIASES_PER_REQUEST));
    }

    const results = await Promise.all(
      batches.map((batch) => this.sendBatch(batch, push)),
    );
    return results.some(Boolean);
  }

  private async sendBatch(
    externalIds: string[],
    push: OutboundPush,
  ): Promise<boolean> {
    try {
      const response = await fetch(ONESIGNAL_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}`,
        },
        body: JSON.stringify({
          app_id: env.ONESIGNAL_APP_ID,
          target_channel: 'push',
          include_aliases: { external_id: externalIds },
          headings: { en: push.title },
          contents: { en: push.body },
          // Read by the app's notification-click handler to route straight to
          // the thing the notification is about, rather than dropping the
          // person on Home to go find it.
          data: push.link
            ? { path: push.link.path, ...push.link.params }
            : undefined,
          collapse_id: push.collapseId,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.error(
          `Failed to send ${push.logLabel}: OneSignal returned ${response.status} ${await response.text()}`,
        );
        return false;
      }

      // A 200 with no `id` means the request was well-formed but matched no
      // subscription — everyone targeted is signed out, has denied
      // permission, or has never opened the app on a device. Worth a debug
      // line and nothing more: it is the normal case, not a fault.
      const payload = (await response.json()) as { id?: string };
      if (!payload.id) {
        this.logger.debug(
          `${push.logLabel} matched no push subscriptions (${externalIds.length} targeted)`,
        );
        return false;
      }

      this.logger.log(
        `Sent ${push.logLabel} to ${externalIds.length} user(s) (${payload.id})`,
      );
      return true;
    } catch (error) {
      // Includes the 5s timeout. A slow push provider must not become a slow
      // API: the caller is already committed and is not waiting on this.
      this.logger.error(`Failed to send ${push.logLabel}: ${error}`);
      return false;
    }
  }
}
