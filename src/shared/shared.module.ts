import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { VaultAccessGuard } from './guards/vault-access.guard';
import { NotificationFeedService } from './services/notification-feed.service';
import { NotificationsGateway } from './services/notifications.gateway';
import { MailerService } from './services/mailer.service';
import { NotificationService } from './services/notification.service';
import { PushService } from './services/push.service';
import { StorageService } from './services/storage.service';

/** Global so feature modules can inject these without re-importing everywhere. */
@Global()
@Module({
  imports: [
    // Only used to verify a socket handshake's access token against the
    // same secret every REST call trusts (NotificationsGateway) — no
    // default here, the secret is always passed explicitly on verifyAsync,
    // same as AuthService.refresh() does for the refresh-token secret.
    JwtModule.register({}),
  ],
  providers: [
    StorageService,
    MailerService,
    PushService,
    NotificationService,
    NotificationFeedService,
    NotificationsGateway,
    // Global rather than declared in VaultModule: MediaController's
    // `move-to-vault` route needs it too (MediaService.moveToVault writes a
    // vaultItems row), and MediaModule can't import VaultModule for it
    // without a cycle back through VaultModule's own MediaModule import.
    VaultAccessGuard,
  ],
  exports: [
    StorageService,
    MailerService,
    PushService,
    NotificationService,
    NotificationFeedService,
    NotificationsGateway,
    VaultAccessGuard,
  ],
})
export class SharedModule {}
