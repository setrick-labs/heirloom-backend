import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { Public } from '../../shared/guards/public.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { FamilyEmailInvitesService } from './family-email-invites.service';
import {
  type AcceptEmailInviteInput,
  acceptEmailInviteInputSchema,
  type SendEmailInvitesInput,
  sendEmailInvitesInputSchema,
} from './validations/family-email-invite.schema';

const Uuid = () => new ParseUUIDPipe({ version: '4' });

/**
 * Invite by email. Admin routes sit under the family; the invitee's routes
 * sit under /family-invites so they never collide with `families/:id`.
 */
@Controller()
export class FamilyEmailInvitesController {
  constructor(private readonly invites: FamilyEmailInvitesService) {}

  // ------------------------------------------------------------ admin

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('families/:id/email-invites')
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) familyId: string,
    @Body(new ZodValidationPipe(sendEmailInvitesInputSchema))
    body: SendEmailInvitesInput,
  ) {
    const result = await this.invites.send(user.id, familyId, body);
    return apiResponse(
      result,
      result.sent.length === 1
        ? 'Invite sent'
        : `${result.sent.length} invites sent`,
    );
  }

  @Get('families/:id/email-invites')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) familyId: string,
  ) {
    return this.invites.listPending(user.id, familyId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('families/:id/email-invites/:inviteId/resend')
  async resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) familyId: string,
    @Param('inviteId', Uuid()) inviteId: string,
  ) {
    return apiResponse(
      await this.invites.resend(user.id, familyId, inviteId),
      'Invite sent again',
    );
  }

  @Delete('families/:id/email-invites/:inviteId')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) familyId: string,
    @Param('inviteId', Uuid()) inviteId: string,
  ) {
    await this.invites.revoke(user.id, familyId, inviteId);
    return apiResponse('Invite cancelled');
  }

  // ------------------------------------------------------------ invitee

  /**
   * Public: the web landing page calls this with the link's token before
   * anyone has signed in. Tightly throttled — it's a token-lookup endpoint.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('family-invites/:token/preview')
  preview(@Param('token') token: string) {
    return this.invites.preview(token);
  }

  /** Invites waiting for the signed-in user's own email. */
  @Get('family-invites/mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.invites.listMine(user.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('family-invites/accept')
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(acceptEmailInviteInputSchema))
    body: AcceptEmailInviteInput,
  ) {
    return apiResponse(
      await this.invites.accept(user.id, body),
      'Joined family',
    );
  }
}
