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
import { and, eq, gt, isNull, or, type SQL } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { authTokens, users } from '../../database/schema';
import { NotificationService } from '../../shared/services/notification.service';
import { asDuration } from '../../shared/types/duration';
import {
  generateNumericCode,
  hashToken,
} from '../../shared/utils/auth-tokens.util';
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

    const tokenHash = hashToken(input.code);
    const record = await this.db.query.authTokens.findFirst({
      where: and(
        eq(authTokens.userId, user.id),
        eq(authTokens.type, 'account_verification'),
        eq(authTokens.tokenHash, tokenHash),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    });
    if (!record) {
      throw new UnauthorizedException(
        'This code is invalid or has expired. Request a new one.',
      );
    }

    await this.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(eq(authTokens.id, record.id));

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

    // "Only the most recent token should be valid" — invalidate any
    // outstanding reset tokens before minting a new one.
    await this.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, user.id),
          eq(authTokens.type, 'password_reset'),
          isNull(authTokens.usedAt),
        ),
      );

    // A 6-digit code rather than an opaque token: it arrives by email and is
    // typed back in by hand, so it has to be short enough to read off a
    // screen. Scoped per user at verification time, which is what keeps a
    // million-value space safe — see resetPassword.
    const rawToken = generateNumericCode();
    await this.db.insert(authTokens).values({
      userId: user.id,
      type: 'password_reset',
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(
        Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000,
      ),
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

    const record = await this.db.query.authTokens.findFirst({
      where: and(
        eq(authTokens.userId, user.id),
        eq(authTokens.type, 'password_reset'),
        eq(authTokens.tokenHash, hashToken(input.code)),
      ),
    });

    if (!record) {
      throw new UnauthorizedException(
        'This code is invalid or has expired. Request a new one.',
      );
    }
    if (record.usedAt) {
      throw new UnauthorizedException(
        'This code has already been used. Request a new one.',
      );
    }
    if (record.expiresAt <= new Date()) {
      throw new UnauthorizedException(
        'This code has expired. Request a new one.',
      );
    }

    const passwordHash = await argon2.hash(input.newPassword);
    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(authTokens)
        .set({ usedAt: now })
        .where(eq(authTokens.id, record.id));
      await tx
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
    });
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
    // Only one live code at a time — matches the reset-token rule ("only
    // the most recent is valid") so resending never leaves an old code usable.
    await this.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, user.id),
          eq(authTokens.type, 'account_verification'),
          isNull(authTokens.usedAt),
        ),
      );

    const code = generateNumericCode(6);
    await this.db.insert(authTokens).values({
      userId: user.id,
      type: 'account_verification',
      tokenHash: hashToken(code),
      expiresAt: new Date(
        Date.now() + env.ACCOUNT_VERIFICATION_CODE_TTL_MINUTES * 60_000,
      ),
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
