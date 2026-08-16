import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { idSchema } from '../../shared/validations/common.schema';
import { JourneysService } from './journeys.service';
import {
  type AddJourneyMembersInput,
  addJourneyMembersInputSchema,
  type CreateJourneyInput,
  createJourneyInputSchema,
  type UpdateJourneyInput,
  updateJourneyInputSchema,
  type SetVisibilityInput,
  setVisibilityInputSchema,
} from './validations/journey.schema';

@Controller('journeys')
export class JourneysController {
  constructor(private readonly journeysService: JourneysService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createJourneyInputSchema))
    body: CreateJourneyInput,
  ) {
    const journey = await this.journeysService.create(user.id, body);
    return apiResponse(journey, 'Journey created');
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('familyId', new ZodValidationPipe(idSchema)) familyId: string,
  ) {
    return this.journeysService.listForFamily(user.id, familyId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.journeysService.findById(user.id, id);
  }

  /** Owner-only. */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateJourneyInputSchema))
    body: UpdateJourneyInput,
  ) {
    const journey = await this.journeysService.update(user.id, id, body);
    return apiResponse(journey, 'Journey updated');
  }

  /** Section 3: owner-only. Switching to 'selected' always carries the full member list. */
  @Patch(':id/visibility')
  async setVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setVisibilityInputSchema))
    body: SetVisibilityInput,
  ) {
    const journey = await this.journeysService.setVisibility(user.id, id, body);
    return apiResponse(journey, 'Journey visibility updated');
  }

  /** Section 7: owner-only, soft-delete with a grace period. */
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const journey = await this.journeysService.initiateDelete(user.id, id);
    return apiResponse(
      journey,
      'Journey deleted. You can undo this while it’s pending.',
    );
  }

  /** Owner-only, only works during the grace period. */
  @Post(':id/cancel-deletion')
  async cancelDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const journey = await this.journeysService.cancelDelete(user.id, id);
    return apiResponse(journey, 'Deletion canceled');
  }

  /** Any viewer with access — resolves who currently has visibility, alias-resolved for them. */
  @Get(':id/members')
  getMembers(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.journeysService.getMembers(user.id, id);
  }

  /** Section 3: owner-only, 'selected' journeys only. */
  @Post(':id/members')
  async addMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addJourneyMembersInputSchema))
    body: AddJourneyMembersInput,
  ) {
    await this.journeysService.addMembers(user.id, id, body);
    return apiResponse('Members added');
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.journeysService.removeMember(user.id, id, targetUserId);
    return apiResponse('Member removed');
  }
}
