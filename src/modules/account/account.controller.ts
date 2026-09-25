import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { AccountDeletionService } from './account-deletion.service';

const deleteAccountInputSchema = z.object({
  /** The current password — deleting an account re-authenticates. */
  password: z.string().min(1),
});
type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;

@Controller('users')
export class AccountController {
  constructor(private readonly accountDeletion: AccountDeletionService) {}

  /**
   * Deletes the signed-in account (Screen 36's "Delete account"). See
   * AccountDeletionService for what is erased and what stays with the family.
   *
   * POST rather than DELETE /users/me: it carries a body (the password), and
   * DELETE bodies are dropped by some proxies and HTTP clients.
   */
  @Post('me/delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(deleteAccountInputSchema)) body: DeleteAccountInput,
  ) {
    return this.accountDeletion.deleteAccount(user.id, body.password);
  }
}
