import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { eq, or, type SQL } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { users } from '../../database/schema';
import { NotificationService } from '../../shared/services/notification.service';
import { asDuration } from '../../shared/types/duration';
import {
  consumeEmailedCode,
  issueEmailedCode,
} from '../../shared/utils/emailed-code.util';
import { resolveActiveFamilyId } from '../../shared/utils/family-membership.util';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import type { User } from '../users/validations/user.schema';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  ResendVerificationInput,
  ResetPasswordInput,
  SignInInput,
  SignUpInput,
  VerifyAccountInput,
} from './validations/auth.schema';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Same shape UsersService.toDto returns for every other endpoint (role,
 * createdAt, updatedAt included) plus one auth-only extra field — kept as a
 * type alias, not a hand-rolled subset, so a session's `user` can never again
 * silently drift from what the rest of the API returns.
 */
export type SafeUser = User & {
  /** Gifting spec Section 5: drives the onboarding-gate carve-out for a gift-invite signup. */
  hasUnclaimedGift: boolean;
};

type UserRow = typeof users.$inferSelect;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly jwtService: JwtService,
    private readonly notificationService: NotificationService,
    private readonly giftsService: GiftsService,
    private readonly usersService: UsersService,
  ) {}

  async signUp(input: SignUpInput): Promise<{ identifier: string }> {
    const identifier = (input.email ?? input.phone) as string;
    const existing = await this.findByIdentifier(input.email, input.phone);

    if (existing) {
      if (existing.status === 'pending') {
        // "Offer to resend" — the reject *is* the offer: we send a fresh
        // code right away rather than making the client round-trip again.
        await this.issueVerificationCode(existing);
        throw new ConflictException({
          code: 'ACCOUNT_PENDING_VERIFICATION',
          message:
            'An account with this email or phone already exists but has not been verified yet. We just sent a new verification code.',
        });
      }
      throw new ConflictException({
        code: 'IDENTIFIER_ALREADY_EXISTS',
        message: 'An account with this email or phone number already exists.',
      });
    }

    const passwordHash = await argon2.hash(input.password);
    const [created] = await this.db
      .insert(users)
      .values({
        email: input.email,
        phone: input.phone,
        passwordHash,
        name: input.name,
        status: 'pending',
      })
      .returning();

    await this.issueVerificationCode(created);

    return { identifier };
  }

  async verifyAccount(
    input: VerifyAccountInput,
  ): Promise<AuthTokens & { user: SafeUser }> {
    const user = await this.findByIdentifierString(input.identifier);
    if (!user) {
      throw new UnauthorizedException('Invalid verification code');
    }

    await consumeEmailedCode(this.db, {
      userId: user.id,
      type: 'account_verification',
      code: input.code,
    });

    const [activated] = await this.db
      .update(users)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();

    // Gifting spec Section 3/5: resolves any Gift(s) waiting on this exact
    // email — whether they signed up right after an invite, or years later.
    if (activated.email) {
      await this.giftsService.resolveRecipientForEmail(
        activated.id,
        activated.email,
      );
    }

    return this.buildSession(activated);
  }

  async resendVerification(input: ResendVerificationInput): Promise<void> {
    const user = await this.findByIdentifierString(input.identifier);
    // Same "don't reveal whether the account exists" posture as forgotPassword.
    if (!user || user.status !== 'pending') {
      return;
    }
    await this.issueVerificationCode(user);
  }

  async signIn(input: SignInInput): Promise<AuthTokens & { user: SafeUser }> {
    const user = await this.findByIdentifier(input.email, input.phone);
    if (!user) {
      throw new UnauthorizedException('Incorrect email/phone or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        {
          code: 'ACCOUNT_LOCKED',
          message: 'Too many failed attempts. Try again in a few minutes.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordMatches = await argon2.verify(
      user.passwordHash,
      input.password,
    );
    if (!passwordMatches) {
      await this.registerFailedLogin(user);
      throw new UnauthorizedException('Incorrect email/phone or password');
    }

    if (user.status === 'pending') {
      throw new ConflictException({
        code: 'ACCOUNT_PENDING_VERIFICATION',
        message:
          'This account has not been verified yet. Request a new code to continue.',
      });
    }
    // Unreachable in practice (a deleted account's email and password are
    // both scrubbed), but never let a deleted account back in by any path.
    if (user.status === 'deleted') {
      throw new UnauthorizedException('Incorrect email/phone or password');
    }
    if (user.status === 'suspended') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account has been suspended. Contact support for help.',
      });
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.db
        .update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
    }

    return this.buildSession(user);
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await this.findByIdentifierString(input.identifier);
    // Deliberately identical response whether or not the account exists —
    // the caller (controller) always returns the same generic message.
    if (!user || user.status !== 'active') {
      return;
    }

    // A 6-digit code rather than an opaque token: it arrives by email and is
    // typed back in by hand, so it has to be short enough to read off a
    // screen. Scoped per user and capped on wrong guesses, which is what
    // keeps a million-value space safe — see emailed-code.util.ts.
    const rawToken = await issueEmailedCode(this.db, {
      userId: user.id,
      type: 'password_reset',
      ttlMinutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    });

    await this.notificationService.sendPasswordResetLink(
      input.identifier,
      rawToken,
    );
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const user = await this.findByIdentifierString(input.identifier);
    // Same wording as a wrong code: whether this address has an account is
    // exactly what forgotPassword refuses to disclose, and answering
    // differently here would give it away.
    if (!user) {
      throw new UnauthorizedException(
        'This code is invalid or has expired. Request a new one.',
      );
    }

    await consumeEmailedCode(this.db, {
      userId: user.id,
      type: 'password_reset',
      code: input.code,
    });

    const passwordHash = await argon2.hash(input.newPassword);
    const now = new Date();

    await this.db
      .update(users)
      .set({
        passwordHash,
        // Locks the attacker out immediately: any already-issued access
        // or refresh token with iat before this is rejected (see
        // JwtStrategy.validate and AuthService.refresh).
        sessionsInvalidatedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await this.notificationService.sendPasswordChanged(user);
  }

  /**
   * Section 2: changing a password from inside the app.
   *
   * Deliberately mirrors `resetPassword`'s aftermath — the new hash lands and
   * `sessionsInvalidatedAt` moves, so every other device is signed out. If the
   * reason for the change is that someone else had the old password, leaving
   * their session alive would defeat the whole exercise.
   */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }

    const matches = await argon2.verify(user.passwordHash, input.currentPassword);
    if (!matches) {
      throw new UnauthorizedException('That is not your current password');
    }

    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException(
        'Your new password needs to be different from the old one',
      );
    }

    const passwordHash = await argon2.hash(input.newPassword);
    const now = new Date();

    await this.db
      .update(users)
      .set({
        passwordHash,
        sessionsInvalidatedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    await this.notificationService.sendPasswordChanged(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string; iat: number };
    try {
      payload = await this.jwtService.verifyAsync<{ sub: string; iat: number }>(
        refreshToken,
        {
          secret: env.JWT_REFRESH_SECRET,
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.db.query.users.findFirst({
      where: eq(users.id, payload.sub),
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (
      user.sessionsInvalidatedAt &&
      payload.iat * 1000 < user.sessionsInvalidatedAt.getTime()
    ) {
      throw new UnauthorizedException(
        'Session has been invalidated. Please sign in again.',
      );
    }

    return this.issueTokens(user.id);
  }

  private async issueVerificationCode(user: UserRow): Promise<void> {
    // Only one live code at a time, so resending never leaves an old code usable.
    const code = await issueEmailedCode(this.db, {
      userId: user.id,
      type: 'account_verification',
      ttlMinutes: env.ACCOUNT_VERIFICATION_CODE_TTL_MINUTES,
    });

    const identifier = user.email ?? user.phone ?? user.id;
    await this.notificationService.sendAccountVerificationCode(
      identifier,
      code,
    );
  }

  private async registerFailedLogin(user: UserRow): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const lockedOut = attempts >= env.LOGIN_LOCKOUT_MAX_ATTEMPTS;

    await this.db
      .update(users)
      .set({
        failedLoginAttempts: lockedOut ? 0 : attempts,
        lockedUntil: lockedOut
          ? new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000)
          : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
  }

  private async buildSession(
    user: UserRow,
  ): Promise<AuthTokens & { user: SafeUser }> {
    const activeFamilyId = await resolveActiveFamilyId(
      this.db,
      user.id,
      user.activeFamilyId,
    );
    if (activeFamilyId !== user.activeFamilyId) {
      await this.db
        .update(users)
        .set({ activeFamilyId })
        .where(eq(users.id, user.id));
    }
    // toDto derives `role` from this row's activeFamilyId, so it needs the
    // just-resolved value, not the possibly-stale one still on `user`.
    const freshUser =
      activeFamilyId === user.activeFamilyId
        ? user
        : { ...user, activeFamilyId };

    const [tokens, hasUnclaimedGift, userDto] = await Promise.all([
      this.issueTokens(user.id),
      this.giftsService.hasUnclaimedGift(user.id),
      this.usersService.toDto(freshUser),
    ]);
    return {
      ...tokens,
      user: { ...userDto, hasUnclaimedGift },
    };
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId },
        {
          secret: env.JWT_ACCESS_SECRET,
          expiresIn: asDuration(env.JWT_ACCESS_EXPIRES_IN),
        },
      ),
      this.jwtService.signAsync(
        { sub: userId },
        {
          secret: env.JWT_REFRESH_SECRET,
          expiresIn: asDuration(env.JWT_REFRESH_EXPIRES_IN),
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async findByIdentifier(
    email?: string,
    phone?: string,
  ): Promise<UserRow | undefined> {
    if (!email && !phone) return undefined;
    const conditions: SQL[] = [];
    if (email) conditions.push(eq(users.email, email));
    if (phone) conditions.push(eq(users.phone, phone));
    return this.db.query.users.findFirst({
      where: or(...conditions),
    });
  }

  private async findByIdentifierString(
    identifier: string,
  ): Promise<UserRow | undefined> {
    return identifier.includes('@')
      ? this.findByIdentifier(identifier, undefined)
      : this.findByIdentifier(undefined, identifier);
  }
}
