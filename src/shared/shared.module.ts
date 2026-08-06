import { Global, Module } from '@nestjs/common';

import { NotificationService } from './services/notification.service';
import { StorageService } from './services/storage.service';

/** Global so feature modules can inject these without re-importing everywhere. */
@Global()
@Module({
  providers: [StorageService, NotificationService],
  exports: [StorageService, NotificationService],
})
export class SharedModule {}
