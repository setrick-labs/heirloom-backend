import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { UsersService } from './users.service';
import {
  type AddEmailInput,
  addEmailInputSchema,
  type ConfirmEmailInput,
  confirmEmailInputSchema,
  type SwitchActiveFamilyInput,
  switchActiveFamilyInputSchema,
  type UpdateNotificationPreferencesInput,
  updateNotificationPreferencesInputSchema,
  type UpdateUserInput,
  updateUserInputSchema,
} from './validations/user.schema';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findById(user.id);
  }

  /** Storage allowance: what they've used of their 30GB, and what's left. */
  @Get('me/storage')
  getMyStorage(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.storageUsage(user.id);
  }

  /** The five push toggles behind Screen 36's Notifications row. */
  @Get('me/notification-preferences')
  getMyNotificationPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.notificationPreferences(user.id);
  }

  @Patch('me/notification-preferences')
  updateMyNotificationPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateNotificationPreferencesInputSchema))
    body: UpdateNotificationPreferencesInput,
  ) {
    return this.usersService.updateNotificationPreferences(user.id, body);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateUserInputSchema)) body: UpdateUserInput,
  ) {
    return this.usersService.update(user.id, body);
  }

  /** Phone-only accounts: send a code to the address being added. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('me/email')
  async addEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addEmailInputSchema)) body: AddEmailInput,
  ) {
    await this.usersService.requestAddEmail(user.id, body);
    return apiResponse('Check your inbox for a 6-digit code.');
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('me/email/confirm')
  confirmEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(confirmEmailInputSchema))
    body: ConfirmEmailInput,
  ) {
    return this.usersService.confirmAddEmail(user.id, body);
  }

  /** Section 6: switch which family workspace is active. */
  @Patch('me/active-family')
  switchActiveFamily(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(switchActiveFamilyInputSchema))
    body: SwitchActiveFamilyInput,
  ) {
    return this.usersService.switchActiveFamily(user.id, body);
  }
}
