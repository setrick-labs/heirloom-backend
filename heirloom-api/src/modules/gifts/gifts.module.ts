import { Module } from '@nestjs/common';

import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';

@Module({
  controllers: [GiftsController],
  providers: [GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
