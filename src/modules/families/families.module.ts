import { Module } from '@nestjs/common';

import { FamiliesController } from './families.controller';
import { FamiliesService } from './families.service';
import { FamilyEmailInvitesController } from './family-email-invites.controller';
import { FamilyEmailInvitesService } from './family-email-invites.service';

@Module({
  controllers: [FamiliesController, FamilyEmailInvitesController],
  providers: [FamiliesService, FamilyEmailInvitesService],
  exports: [FamiliesService],
})
export class FamiliesModule {}
