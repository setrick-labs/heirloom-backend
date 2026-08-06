import { Body, Controller, Get, Param, Post } from '@nestjs/common';

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
  type CreateFamilyInput,
  createFamilyInputSchema,
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
