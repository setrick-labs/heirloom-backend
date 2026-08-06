import { Controller, Get, Patch, Body } from '@nestjs/common';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { UsersService } from './users.service';
import {
  type SwitchActiveFamilyInput,
  switchActiveFamilyInputSchema,
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

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateUserInputSchema)) body: UpdateUserInput,
  ) {
    return this.usersService.update(user.id, body);
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
