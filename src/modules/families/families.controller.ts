import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { FamiliesService } from './families.service';
import {
  type JoinFamilyInput,
  joinFamilyInputSchema,
} from './validations/family-invite.schema';
import {
  type SetAliasInput,
  setAliasInputSchema,
  type SetOwnNicknameInput,
  setOwnNicknameInputSchema,
} from './validations/family-member.schema';
import {
  type CreateFamilyInput,
  createFamilyInputSchema,
  type DeleteFamilyInput,
  deleteFamilyInputSchema,
  type UpdateFamilyInput,
  updateFamilyInputSchema,
} from './validations/family.schema';

@Controller('families')
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createFamilyInputSchema))
    body: CreateFamilyInput,
  ) {
    const family = await this.familiesService.create(user.id, body);
    return apiResponse(family, 'Family created');
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.familiesService.listForUser(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.familiesService.findById(id);
  }

  /** Section 8: admin-only. */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFamilyInputSchema))
    body: UpdateFamilyInput,
  ) {
    const family = await this.familiesService.updateFamily(user.id, id, body);
    return apiResponse(family, 'Family updated');
  }

  /** Section 7: admin-only, soft-delete with a grace period. `confirmName` must match exactly. */
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deleteFamilyInputSchema))
    body: DeleteFamilyInput,
  ) {
    const family = await this.familiesService.initiateDelete(
      user.id,
      id,
      body.confirmName,
    );
    return apiResponse(
      family,
      'Family deleted. You can undo this while it’s pending.',
    );
  }

  /** Admin-only, only works during the grace period. */
  @Post(':id/cancel-deletion')
  async cancelDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const family = await this.familiesService.cancelDelete(user.id, id);
    return apiResponse(family, 'Deletion canceled');
  }

  /** Section 3: any member. */
  @Get(':id/members')
  getMembers(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.familiesService.getMembers(user.id, id);
  }

  /**
   * Screen 14 / Screen 34's own-row "Edit" — public within the family.
   * Hardcoded `me` rather than a :userId, so there is no shape of this
   * request that sets somebody else's public name.
   */
  @Patch(':id/members/me/nickname')
  async setOwnNickname(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setOwnNicknameInputSchema))
    body: SetOwnNicknameInput,
  ) {
    await this.familiesService.setOwnNickname(user.id, id, body.nickname);
    return apiResponse('Nickname saved');
  }

  /** Section 2: private, per-viewer. */
  @Patch(':id/members/:userId/alias')
  async setAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body(new ZodValidationPipe(setAliasInputSchema)) body: SetAliasInput,
  ) {
    await this.familiesService.setAlias(
      user.id,
      id,
      targetUserId,
      body.nickname,
    );
    return apiResponse('Alias saved');
  }

  @Delete(':id/members/:userId/alias')
  async clearAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.familiesService.clearAlias(user.id, id, targetUserId);
    return apiResponse('Alias removed');
  }

  /** Section 5: admin-only. */
  @Post(':id/members/:userId/promote')
  async promote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.familiesService.promoteMember(user.id, id, targetUserId);
    return apiResponse('Member promoted to admin');
  }

  /** Section 4: admin-only, cannot target yourself (use /leave instead). */
  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.familiesService.removeMember(user.id, id, targetUserId);
    return apiResponse('Member removed');
  }

  /** Section 6: self-service. May cascade into family deletion if this was the last member. */
  @Post(':id/leave')
  async leave(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const result = await this.familiesService.leaveFamily(user.id, id);
    return apiResponse(
      result,
      result.familyDeleted
        ? 'You left, and the family was deleted with you.'
        : 'You left the family',
    );
  }

  /** Admin/owner only — generating a fresh code revokes the family's previous one. */
  @Post(':id/invites')
  async generateInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const invite = await this.familiesService.generateInvite(user.id, id);
    return apiResponse(invite, 'Invite code generated');
  }

  /** Preview before committing — family name + member count, no private content. */
  @Get('invites/:code/preview')
  preview(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.familiesService.previewInvite(user.id, code);
  }

  @Post('invites/join')
  async join(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(joinFamilyInputSchema)) body: JoinFamilyInput,
  ) {
    const family = await this.familiesService.joinViaInvite(user.id, body);
    return apiResponse(family, 'Joined family');
  }
}
