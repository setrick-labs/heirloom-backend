import { Module } from '@nestjs/common';

import { GiftsModule } from '../gifts/gifts.module';
import { JourneysController } from './journeys.controller';
import { JourneysService } from './journeys.service';

@Module({
  // GiftsModule doesn't import JourneysModule back — Gifting only depends on
  // Journeys via the shared journey-access util, not JourneysService — so
  // this isn't circular.
  imports: [GiftsModule],
  controllers: [JourneysController],
  providers: [JourneysService],
  exports: [JourneysService],
})
export class JourneysModule {}
