import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  familyEmailInvites,
  familyMembers,
  users,
  type FamilyEmailInviteRow,
} from '../../database/schema';
import { NotificationService } from '../../shared/services/notification.service';
import {
  generateOpaqueToken,
  hashToken,
} from '../../shared/utils/auth-tokens.util';
import { maskEmail } from '../../shared/utils/mask-email.util';
import { FamiliesService } from './families.service';
import type { Family } from './validations/family.schema';
import type {
  AcceptEmailInviteInput,
  EmailInvitePreview,
  FamilyEmailInvite,
  MyEmailInvite,
  SendEmailInvitesInput,
  SendEmailInvitesResult,
} from './validations/family-email-invite.schema';

const INVALID_LINK =
  'This invite is no longer valid. Ask the family admin to send a new one.';

/**
 * Invite by email: a single-use link bound to one address, alongside the
 * family's reusable 6-digit code (which is unchanged).
 *
 * The link carries an opaque 32-byte token; only its hash is stored. Anyone
 * holding the link can *preview* the invite (family name, inviter, masked
 * address) — that is what the web landing page shows — but accepting it
 * requires being signed in as the invited address. A forwarded link is
 * therefore useless to whoever it was forwarded to.
 */
@Injectable()
export class FamilyEmailInvitesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly families: FamiliesService,
    private readonly notificationService: NotificationService,
  ) {}

  async send(
    userId: string,
    familyId: string,
    input: SendEmailInvitesInput,
  ): Promise<SendEmailInvitesResult> {
    await this.families.requireAdmin(userId, familyId);
    const [family, inviter] = await Promise.all([
      this.families.findById(familyId),
      this.requireUser(userId),
    ]);

    const emails = [...new Set(input.emails.map(normalizeEmail))];
    await this.assertWithinDailyLimit(userId, emails.length);

    // Addresses that are already in the family get nothing — no email, no row.
    const existingAccounts = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(sql`lower(${users.email})`, emails));
    const accountByEmail = new Map(
      existingAccounts.map((a) => [normalizeEmail(a.email!), a.id]),
    );
    const memberIds = accountByEmail.size
      ? new Set(
          (
            await this.db
              .select({ userId: familyMembers.userId })
              .from(familyMembers)
              .where(
                and(
                  eq(familyMembers.familyId, familyId),
                  inArray(familyMembers.userId, [...accountByEmail.values()]),
                ),
              )
          ).map((m) => m.userId),
        )
      : new Set<string>();

    const alreadyMembers: string[] = [];
    const sent: FamilyEmailInvite[] = [];

    for (const email of emails) {
      const accountId = accountByEmail.get(email);
      if (accountId && memberIds.has(accountId)) {
        alreadyMembers.push(email);
        continue;
      }
      const { row, token } = await this.upsertPending(familyId, email, userId);
      await this.notificationService.sendFamilyInvite({
        to: email,
        inviterName: inviter.name,
        familyName: family.name,
        memberCount: family.memberCount,
        url: inviteUrl(token),
        existingUserId: accountId,
        inviteId: row.id,
      });
      sent.push(this.toDto(row, inviter.name));
    }

    return { sent, alreadyMembers };
  }

  async listPending(
    userId: string,
    familyId: string,
  ): Promise<FamilyEmailInvite[]> {
    await this.families.requireAdmin(userId, familyId);
    const rows = await this.db
      .select({ invite: familyEmailInvites, inviterName: users.name })
      .from(familyEmailInvites)
      .innerJoin(users, eq(users.id, familyEmailInvites.invitedBy))
      .where(
        and(
          eq(familyEmailInvites.familyId, familyId),
          isNull(familyEmailInvites.acceptedAt),
          isNull(familyEmailInvites.revokedAt),
        ),
      )
      .orderBy(desc(familyEmailInvites.lastSentAt));
    return rows.map((r) => this.toDto(r.invite, r.inviterName));
  }

  /** New token and a fresh expiry; the previous link stops working. */
  async resend(
    userId: string,
    familyId: string,
    inviteId: string,
  ): Promise<FamilyEmailInvite> {
    await this.families.requireAdmin(userId, familyId);
    const existing = await this.requirePendingInFamily(familyId, inviteId);
    await this.assertWithinDailyLimit(userId, 1);
    const [family, inviter] = await Promise.all([
      this.families.findById(familyId),
      this.requireUser(userId),
    ]);
    const { row, token } = await this.upsertPending(
      familyId,
      existing.email,
      userId,
    );
    const account = await this.findAccountByEmail(existing.email);
    await this.notificationService.sendFamilyInvite({
      to: existing.email,
      inviterName: inviter.name,
      familyName: family.name,
      memberCount: family.memberCount,
      url: inviteUrl(token),
      existingUserId: account?.id,
      inviteId: row.id,
    });
    return this.toDto(row, inviter.name);
  }

  async revoke(
    userId: string,
    familyId: string,
    inviteId: string,
  ): Promise<void> {
    await this.families.requireAdmin(userId, familyId);
    await this.requirePendingInFamily(familyId, inviteId);
    await this.db
      .update(familyEmailInvites)
      .set({ revokedAt: new Date() })
      .where(eq(familyEmailInvites.id, inviteId));
  }

  /** Public — backs the web landing page and the app's invite screen. */
  async preview(token: string): Promise<EmailInvitePreview> {
    const invite = await this.findLiveByToken(token);
    return this.previewOf(invite);
  }

  /** Invites addressed to the caller's own email — the post-install path. */
  async listMine(userId: string): Promise<MyEmailInvite[]> {
    const user = await this.requireUser(userId);
    if (!user.email) return [];
    const rows = await this.db.query.familyEmailInvites.findMany({
      where: and(
        eq(familyEmailInvites.email, normalizeEmail(user.email)),
        isNull(familyEmailInvites.acceptedAt),
        isNull(familyEmailInvites.revokedAt),
        gt(familyEmailInvites.expiresAt, new Date()),
      ),
      orderBy: desc(familyEmailInvites.lastSentAt),
    });

    const mine: MyEmailInvite[] = [];
    for (const row of rows) {
      // An invite to a family you've since joined (by code, say) isn't news.
      const alreadyIn = await this.db.query.familyMembers.findFirst({
        where: and(
          eq(familyMembers.familyId, row.familyId),
          eq(familyMembers.userId, userId),
        ),
      });
      if (alreadyIn) continue;
      const preview = await this.previewOf(row).catch(() => null);
      if (!preview) continue; // family deleted since
      mine.push({
        id: row.id,
        familyId: row.familyId,
        familyName: preview.familyName,
        inviterName: preview.inviterName,
        memberCount: preview.memberCount,
        expiresAt: row.expiresAt.toISOString(),
      });
    }
    return mine;
  }

  async accept(userId: string, input: AcceptEmailInviteInput): Promise<Family> {
    const invite = input.token
      ? await this.findLiveByToken(input.token)
      : await this.findLiveById(input.inviteId!);

    const user = await this.requireUser(userId);
    if (!user.email || normalizeEmail(user.email) !== invite.email) {
      throw new ForbiddenException({
        code: 'INVITE_EMAIL_MISMATCH',
        message: `This invite was sent to ${maskEmail(invite.email)}. Sign in with that account to accept it.`,
        invitedEmail: maskEmail(invite.email),
      });
    }

    // Claim first, conditional on still being pending, so a double tap (or
    // two devices) can't both run the join.
    const [claimed] = await this.db
      .update(familyEmailInvites)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(
        and(
          eq(familyEmailInvites.id, invite.id),
          isNull(familyEmailInvites.acceptedAt),
          isNull(familyEmailInvites.revokedAt),
        ),
      )
      .returning();
    if (!claimed) throw new NotFoundException(INVALID_LINK);

    return this.families.joinFamily(userId, invite.familyId);
  }

  // ------------------------------------------------------------ internals

  private async upsertPending(
    familyId: string,
    email: string,
    invitedBy: string,
  ): Promise<{ row: FamilyEmailInviteRow; token: string }> {
    const token = generateOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + env.FAMILY_EMAIL_INVITE_TTL_DAYS * 86_400_000,
    );
    const pending = await this.db.query.familyEmailInvites.findFirst({
      where: and(
        eq(familyEmailInvites.familyId, familyId),
        eq(familyEmailInvites.email, email),
        isNull(familyEmailInvites.acceptedAt),
        isNull(familyEmailInvites.revokedAt),
      ),
    });

    if (pending) {
      const [row] = await this.db
        .update(familyEmailInvites)
        .set({
          tokenHash: hashToken(token),
          invitedBy,
          expiresAt,
          lastSentAt: now,
        })
        .where(eq(familyEmailInvites.id, pending.id))
        .returning();
      return { row, token };
    }

    const [row] = await this.db
      .insert(familyEmailInvites)
      .values({
        familyId,
        email,
        invitedBy,
        tokenHash: hashToken(token),
        expiresAt,
        lastSentAt: now,
      })
      .returning();
    return { row, token };
  }

  /**
   * Invite mail leaves from our domain to addresses a user typed, so it is
   * capped per sender per day — otherwise this is a free spam relay.
   */
  private async assertWithinDailyLimit(
    userId: string,
    adding: number,
  ): Promise<void> {
    const since = new Date(Date.now() - 86_400_000);
    const [{ sentToday }] = await this.db
      .select({ sentToday: count() })
      .from(familyEmailInvites)
      .where(
        and(
          eq(familyEmailInvites.invitedBy, userId),
          gt(familyEmailInvites.lastSentAt, since),
        ),
      );
    if (sentToday + adding > env.FAMILY_EMAIL_INVITES_PER_DAY) {
      throw new HttpException(
        {
          code: 'INVITE_LIMIT_REACHED',
          message: `You can send up to ${env.FAMILY_EMAIL_INVITES_PER_DAY} email invites a day. Try again tomorrow, or share the invite code instead.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async findLiveByToken(token: string): Promise<FamilyEmailInviteRow> {
    const invite = await this.db.query.familyEmailInvites.findFirst({
      where: eq(familyEmailInvites.tokenHash, hashToken(token)),
    });
    return this.assertLive(invite);
  }

  private async findLiveById(id: string): Promise<FamilyEmailInviteRow> {
    const invite = await this.db.query.familyEmailInvites.findFirst({
      where: eq(familyEmailInvites.id, id),
    });
    return this.assertLive(invite);
  }

  /** Unknown, used, revoked and expired all read the same — nothing to probe. */
  private assertLive(
    invite: FamilyEmailInviteRow | undefined,
  ): FamilyEmailInviteRow {
    if (
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt <= new Date()
    ) {
      throw new NotFoundException(INVALID_LINK);
    }
    return invite;
  }

  private async previewOf(
    invite: FamilyEmailInviteRow,
  ): Promise<EmailInvitePreview> {
    const [family, inviter] = await Promise.all([
      this.families.findById(invite.familyId).catch(() => null),
      this.db.query.users.findFirst({ where: eq(users.id, invite.invitedBy) }),
    ]);
    if (!family) throw new NotFoundException(INVALID_LINK);
    return {
      familyName: family.name,
      inviterName: inviter?.name ?? 'A family member',
      memberCount: family.memberCount,
      invitedEmail: maskEmail(invite.email),
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  private async requirePendingInFamily(
    familyId: string,
    inviteId: string,
  ): Promise<FamilyEmailInviteRow> {
    const invite = await this.db.query.familyEmailInvites.findFirst({
      where: and(
        eq(familyEmailInvites.id, inviteId),
        eq(familyEmailInvites.familyId, familyId),
        isNull(familyEmailInvites.acceptedAt),
        isNull(familyEmailInvites.revokedAt),
      ),
    });
    if (!invite) throw new NotFoundException('Invite not found');
    return invite;
  }

  private async findAccountByEmail(email: string) {
    return this.db.query.users.findFirst({
      where: eq(sql`lower(${users.email})`, email),
    });
  }

  private async requireUser(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private toDto(
    row: FamilyEmailInviteRow,
    invitedByName: string,
  ): FamilyEmailInvite {
    return {
      id: row.id,
      email: row.email,
      invitedByName,
      expiresAt: row.expiresAt.toISOString(),
      lastSentAt: row.lastSentAt.toISOString(),
      expired: row.expiresAt <= new Date(),
    };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * `/i/<token>` on the web domain — a universal link (iOS) / App Link
 * (Android) that opens the app directly when installed, and the web landing
 * page with store badges when not.
 */
function inviteUrl(token: string): string {
  const base = (env.APP_LINK_BASE_URL ?? env.WEB_BASE_URL).replace(/\/$/, '');
  return `${base}/i/${token}`;
}
