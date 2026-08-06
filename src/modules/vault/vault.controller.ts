import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { VaultAccessGuard } from './vault-access.guard';
import { VaultService } from './vault.service';
import {
  type CreateVaultItemInput,
  createVaultItemInputSchema,
  type RecoverVaultInput,
  recoverVaultInputSchema,
  type RequestVaultUploadUrlInput,
  requestVaultUploadUrlInputSchema,
  type SetupVaultInput,
  setupVaultInputSchema,
  type UnlockVaultInput,
  unlockVaultInputSchema,
} from './validations/vault.schema';

@Controller('vault')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  /** No vault token needed — this is how the client decides whether to show setup vs. unlock. */
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.vaultService.status(user.id);
  }

  @Post('setup')
  async setup(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setupVaultInputSchema)) body: SetupVaultInput,
  ) {
    const session = await this.vaultService.setup(user.id, body);
    return apiResponse(session, 'Vault ready');
  }

  @Post('unlock')
  async unlock(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(unlockVaultInputSchema)) body: UnlockVaultInput,
  ) {
    const session = await this.vaultService.unlock(user.id, body);
    return apiResponse(session, 'Vault unlocked');
  }

  @Post('recover')
  async recover(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(recoverVaultInputSchema))
    body: RecoverVaultInput,
  ) {
    const session = await this.vaultService.recover(user.id, body);
    return apiResponse(session, 'Vault password reset');
  }

  /**
   * Everything below requires a valid vault token (VaultAccessGuard), on
   * top of the normal JWT already required globally — Section 1: the Vault
   * never inherits trust from the main app session.
   */
  @UseGuards(VaultAccessGuard)
  @Post('upload-url')
  requestUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(requestVaultUploadUrlInputSchema))
    body: RequestVaultUploadUrlInput,
  ) {
    return this.vaultService.requestUploadUrl(
      user.id,
      body.contentType,
      body.sizeBytes,
    );
  }

  @UseGuards(VaultAccessGuard)
  @Post('items')
  async createItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createVaultItemInputSchema))
    body: CreateVaultItemInput,
  ) {
    const item = await this.vaultService.createItem(user.id, body);
    return apiResponse(item, 'Added to Vault');
  }

  @UseGuards(VaultAccessGuard)
  @Get('items')
  listItems(@CurrentUser() user: AuthenticatedUser) {
    return this.vaultService.listItems(user.id);
  }

  @UseGuards(VaultAccessGuard)
  @Delete('items/:id')
  async deleteItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.vaultService.deleteItem(user.id, id);
    return apiResponse('Removed from Vault');
  }
}
