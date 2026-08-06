import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../shared/guards/public.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { AuthService } from './auth.service';
import {
  type ForgotPasswordInput,
  forgotPasswordInputSchema,
  type RefreshTokenInput,
  refreshTokenInputSchema,
  type ResendVerificationInput,
  resendVerificationInputSchema,
  type ResetPasswordInput,
  resetPasswordInputSchema,
  type SignInInput,
  signInInputSchema,
  type SignUpInput,
  signUpInputSchema,
  type VerifyAccountInput,
  verifyAccountInputSchema,
} from './validations/auth.schema';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sign-up')
  async signUp(
    @Body(new ZodValidationPipe(signUpInputSchema)) body: SignUpInput,
  ) {
    const result = await this.authService.signUp(body);
    return apiResponse(
      result,
      'Account created. Check your email/phone for a verification code.',
    );
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('verify')
  async verify(
    @Body(new ZodValidationPipe(verifyAccountInputSchema))
    body: VerifyAccountInput,
  ) {
    const result = await this.authService.verifyAccount(body);
    return apiResponse(result, 'Account verified.');
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  async resendVerification(
    @Body(new ZodValidationPipe(resendVerificationInputSchema))
    body: ResendVerificationInput,
  ) {
    await this.authService.resendVerification(body);
    return apiResponse(
      'If that account needs verification, a new code has been sent.',
    );
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('sign-in')
  signIn(@Body(new ZodValidationPipe(signInInputSchema)) body: SignInInput) {
    return this.authService.signIn(body);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordInputSchema))
    body: ForgotPasswordInput,
  ) {
    await this.authService.forgotPassword(body);
    // Identical response whether or not the account exists — anti-enumeration.
    return apiResponse(
      'If an account exists, password reset instructions have been sent.',
    );
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordInputSchema))
    body: ResetPasswordInput,
  ) {
    await this.authService.resetPassword(body);
    return apiResponse('Password reset. Please sign in again.');
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(
    @Body(new ZodValidationPipe(refreshTokenInputSchema))
    body: RefreshTokenInput,
  ) {
    return this.authService.refresh(body.refreshToken);
  }
}
