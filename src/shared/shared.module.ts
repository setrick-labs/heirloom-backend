import { Global, Module } from '@nestjs/common';

import { MailerService } from './services/mailer.service';
import { NotificationService } from './services/notification.service';
import { StorageService } from './services/storage.service';

/** Global so feature modules can inject these without re-importing everywhere. */
@Global()
@Module({
  providers: [StorageService, MailerService, NotificationService],
  exports: [StorageService, MailerService, NotificationService],
})
export class SharedModule {}
