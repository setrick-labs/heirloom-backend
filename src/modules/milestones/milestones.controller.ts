import { Controller, Get, Param, Post, Query, Body } from '@nestjs/common';

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
}
