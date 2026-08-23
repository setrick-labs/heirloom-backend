import { Global, Module } from '@nestjs/common';

import { MailerService } from './services/mailer.service';
import { NotificationService } from './services/notification.service';
import { PushService } from './services/push.service';
import { StorageService } from './services/storage.service';

/** Global so feature modules can inject these without re-importing everywhere. */
@Global()
@Module({
  providers: [StorageService, MailerService, PushService, NotificationService],
  exports: [StorageService, MailerService, PushService, NotificationService],
})
export class SharedModule {}
