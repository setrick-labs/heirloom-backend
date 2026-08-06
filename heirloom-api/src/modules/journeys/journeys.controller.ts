import { Controller, Get, Param, Post, Query, Body } from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { idSchema } from '../../shared/validations/common.schema';
import { JourneysService } from './journeys.service';
import {
  type CreateJourneyInput,
  createJourneyInputSchema,
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
  list(@Query('familyId', new ZodValidationPipe(idSchema)) familyId: string) {
    return this.journeysService.listByFamily(familyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.journeysService.findById(id);
  }
}
