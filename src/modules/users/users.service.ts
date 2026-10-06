import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { users } from '../../database/schema';
import { NotificationService } from '../../shared/services/notification.service';
import { StorageService } from '../../shared/services/storage.service';
import { resolveStoredImageUrl } from '../../shared/utils/cover-url.util';
import {
  consumeEmailedCode,
  issueEmailedCode,
} from '../../shared/utils/emailed-code.util';
import {
  getFamilyMembership,
  isActiveFamilyMember,
  resolveActiveFamilyId,
} from '../../shared/utils/family-membership.util';
import {
  getUserStorageUsage,
  type StorageUsage,
} from '../../shared/utils/storage-quota.util';
import {
  AddEmailInput,
  ConfirmEmailInput,
  NotificationPreferences,
  SwitchActiveFamilyInput,
  UpdateNotificationPreferencesInput,
  UpdateUserInput,
  User,
} from './validations/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
    private readonly notificationService: NotificationService,
  ) {}

  /** Step 1 of adding an email to an account that has none. */
  async requestAddEmail(id: string, input: AddEmailInput): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.email) {
      throw new ConflictException('This account already has an email address.');
    }
    const email = input.email.trim();
    const taken = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (taken) {
      throw new ConflictException({
        code: 'IDENTIFIER_ALREADY_EXISTS',
        message: 'Another account already uses this email address.',
      });
    }
    const code = await issueEmailedCode(this.db, {
      userId: id,
      type: 'email_change',
      ttlMinutes: env.ACCOUNT_VERIFICATION_CODE_TTL_MINUTES,
      email,
    });
    await this.notificationService.sendConfirmEmailCode(email, code);
  }

  /** Step 2: the code proves the inbox; only then is the address attached. */
  async confirmAddEmail(id: string, input: ConfirmEmailInput): Promise<User> {
    const record = await consumeEmailedCode(this.db, {
      userId: id,
      type: 'email_change',
      code: input.code,
    });
    if (!record.email) throw new NotFoundException('Nothing to confirm');
    try {
      await this.db
        .update(users)
        .set({ email: record.email, updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.email)));
    } catch {
      // Unique violation: someone else claimed the address meanwhile.
      throw new ConflictException({
        code: 'IDENTIFIER_ALREADY_EXISTS',
        message: 'Another account already uses this email address.',
      });
    }
    return this.findById(id);
  }

  /** The five push toggles (Screen 36), as the app's own field names. */
  async notificationPreferences(id: string): Promise<NotificationPreferences> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toNotificationPreferences(user);
  }

  /**
   * Flips one or more toggles.
   *
   * A partial update, so tapping one switch sends one field. An empty body
   * is a no-op read rather than an error — it costs nothing and spares the
   * client from having to care whether anything actually changed.
   */
  async updateNotificationPreferences(
    id: string,
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    const changes = {
      ...(input.memories === undefined
        ? {}
        : { notifyMemories: input.memories }),
      ...(input.comments === undefined
        ? {}
        : { notifyComments: input.comments }),
      ...(input.versions === undefined
        ? {}
        : { notifyVersions: input.versions }),
      ...(input.invites === undefined ? {} : { notifyInvites: input.invites }),
      ...(input.gifts === undefined ? {} : { notifyGifts: input.gifts }),
    };

    if (Object.keys(changes).length === 0) {
      return this.notificationPreferences(id);
    }

    const [updated] = await this.db
      .update(users)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return toNotificationPreferences(updated);
  }

  /**
   * How much of their allowance this person has spent (Screen 36's storage
   * row). Read live from the media/vault rows they own — see
   * shared/utils/storage-quota.util.ts for why it isn't a stored counter.
   */
  async storageUsage(id: string): Promise<StorageUsage> {
    return getUserStorageUsage(this.db, id);
  }

  async findById(id: string): Promise<User> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Self-heals a stale activeFamilyId (e.g. removed from what had been
    // their active family) on every /users/me call — the guaranteed
    // "next app interaction" the family functional spec asks for, beyond
    // whatever proactive fix the action that caused it already attempted.
    const resolvedActiveFamilyId = await resolveActiveFamilyId(
      this.db,
      id,
      user.activeFamilyId,
    );
    if (resolvedActiveFamilyId !== user.activeFamilyId) {
      const [healed] = await this.db
        .update(users)
        .set({ activeFamilyId: resolvedActiveFamilyId })
        .where(eq(users.id, id))
        .returning();
      return this.toDto(healed);
    }

    return this.toDto(user);
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const [updated] = await this.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return this.toDto(updated);
  }

  /** Section 6: switching families — must already be a member, this doesn't join. */
  async switchActiveFamily(
    userId: string,
    input: SwitchActiveFamilyInput,
  ): Promise<User> {
    const isMember = await isActiveFamilyMember(
      this.db,
      userId,
      input.familyId,
    );
    if (!isMember) {
      throw new ForbiddenException('You are not a member of that family');
    }

    const [updated] = await this.db
      .update(users)
      .set({ activeFamilyId: input.familyId, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    return this.toDto(updated);
  }

  /** Public so other modules (e.g. AuthService, building a post sign-in/verify session) shape a user row identically instead of drifting out of sync with a hand-rolled subset. */
  async toDto(row: typeof users.$inferSelect): Promise<User> {
    const membership = row.activeFamilyId
      ? await getFamilyMembership(this.db, row.id, row.activeFamilyId)
      : undefined;

    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      name: row.name,
      // Presigned fresh from avatarStorageKey when the photo was uploaded
      // through the app; falls back to the plain column.
      avatarUrl: await resolveStoredImageUrl(
        this.storageService,
        row.avatarStorageKey,
        row.avatarUrl,
      ),
      bio: row.bio,
      role: membership?.role ?? 'member',
      activeFamilyId: row.activeFamilyId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Column names to API names.
 *
 * The DB says `notify_memories` because a boolean column reads better with a
 * verb; the API says `memories` because it is already inside a
 * `notificationPreferences` object and repeating the word is noise. One
 * mapper, so the two never drift.
 */
function toNotificationPreferences(user: {
  notifyMemories: boolean;
  notifyComments: boolean;
  notifyVersions: boolean;
  notifyInvites: boolean;
  notifyGifts: boolean;
}): NotificationPreferences {
  return {
    memories: user.notifyMemories,
    comments: user.notifyComments,
    versions: user.notifyVersions,
    invites: user.notifyInvites,
    gifts: user.notifyGifts,
  };
}
