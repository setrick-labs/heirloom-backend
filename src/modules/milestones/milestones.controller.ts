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
import { MilestonesService } from './milestones.service';
import {
  type CreateMilestoneInput,
  createMilestoneInputSchema,
  type RenameMilestoneInput,
  renameMilestoneInputSchema,
} from './validations/milestone.schema';

@Controller('milestones')
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMilestoneInputSchema))
    body: CreateMilestoneInput,
  ) {
    const milestone = await this.milestonesService.create(user.id, body);
    return apiResponse(milestone, 'Milestone created');
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('journeyId', new ZodValidationPipe(idSchema)) journeyId: string,
  ) {
    return this.milestonesService.listByJourney(user.id, journeyId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.milestonesService.findById(user.id, id);
  }

  /** Section 8: creator or journey owner. */
  @Patch(':id')
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameMilestoneInputSchema))
    body: RenameMilestoneInput,
  ) {
    const milestone = await this.milestonesService.rename(user.id, id, body);
    return apiResponse(milestone, 'Milestone renamed');
  }

  /** Section 8: creator or journey owner, soft-delete with a grace period. */
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const milestone = await this.milestonesService.initiateDelete(user.id, id);
    return apiResponse(
      milestone,
      'Milestone deleted. You can undo this while it’s pending.',
    );
  }

  @Post(':id/cancel-deletion')
  async cancelDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const milestone = await this.milestonesService.cancelDelete(user.id, id);
    return apiResponse(milestone, 'Deletion canceled');
  }
}
