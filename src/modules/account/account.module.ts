import { Module } from '@nestjs/common';

import { FamiliesModule } from '../families/families.module';
import { SharedVaultsModule } from '../shared-vaults/shared-vaults.module';
import { AccountController } from './account.controller';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Account lifecycle that spans the whole app — today, deletion. Its own
 * module because it reaches into families and shared vaults, and nothing
 * should depend on it in return.
 */
@Module({
  imports: [FamiliesModule, SharedVaultsModule],
  controllers: [AccountController],
  providers: [AccountDeletionService],
})
export class AccountModule {}
