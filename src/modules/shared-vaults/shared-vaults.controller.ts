import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { apiResponse } from '../../shared/types/api-response';
import { SharedVaultAccessGuard } from './shared-vault-access.guard';
import { SharedVaultsService } from './shared-vaults.service';
import {
  type AcceptSharedVaultInput,
  acceptSharedVaultInputSchema,
  type ChangeSharedVaultPasscodeInput,
  changeSharedVaultPasscodeInputSchema,
  type CreateSharedVaultInput,
  createSharedVaultInputSchema,
  type CreateSharedVaultItemInput,
  createSharedVaultItemInputSchema,
  type InviteSharedVaultMembersInput,
  inviteSharedVaultMembersInputSchema,
  type RecoverSharedVaultInput,
  recoverSharedVaultInputSchema,
  type RenameSharedVaultInput,
  renameSharedVaultInputSchema,
  type RequestSharedVaultUploadUrlInput,
  requestSharedVaultUploadUrlInputSchema,
  type UnlockSharedVaultInput,
  unlockSharedVaultInputSchema,
} from './validations/shared-vault.schema';

const VaultId = () => new ParseUUIDPipe({ version: '4' });

/**
 * Shared Vaults. The first block needs only the normal signed-in session —
 * listing, creating, answering an invite, unlocking. Everything that shows
 * or changes what's inside needs the vault's own token as well
 * (SharedVaultAccessGuard), exactly like the personal Vault.
 */
@Controller('shared-vaults')
export class SharedVaultsController {
  constructor(private readonly sharedVaults: SharedVaultsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.sharedVaults.list(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSharedVaultInputSchema)) body: CreateSharedVaultInput,
  ) {
    return apiResponse(await this.sharedVaults.create(user.id, body), 'Shared vault created');
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', VaultId()) id: string) {
    return this.sharedVaults.get(user.id, id);
  }

  @Post(':id/accept')
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Body(new ZodValidationPipe(acceptSharedVaultInputSchema)) body: AcceptSharedVaultInput,
  ) {
    return apiResponse(await this.sharedVaults.accept(user.id, id, body), 'Welcome in');
  }

  @Post(':id/decline')
  async decline(@CurrentUser() user: AuthenticatedUser, @Param('id', VaultId()) id: string) {
    await this.sharedVaults.decline(user.id, id);
    return apiResponse('Invitation declined');
  }

  @Post(':id/leave')
  async leave(@CurrentUser() user: AuthenticatedUser, @Param('id', VaultId()) id: string) {
    await this.sharedVaults.leave(user.id, id);
    return apiResponse('You left the vault');
  }

  // Tighter than the global limit: this is a passcode guess endpoint, and
  // the per-member lockout is the real defence, not the only one.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/unlock')
  async unlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Body(new ZodValidationPipe(unlockSharedVaultInputSchema)) body: UnlockSharedVaultInput,
  ) {
    return apiResponse(await this.sharedVaults.unlock(user.id, id, body), 'Vault unlocked');
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/recover')
  async recover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Body(new ZodValidationPipe(recoverSharedVaultInputSchema)) body: RecoverSharedVaultInput,
  ) {
    return apiResponse(await this.sharedVaults.recover(user.id, id, body), 'Passcode reset');
  }

  // ---------------------------------------------------- behind the vault token

  @UseGuards(SharedVaultAccessGuard)
  @Patch(':id')
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Body(new ZodValidationPipe(renameSharedVaultInputSchema)) body: RenameSharedVaultInput,
  ) {
    return apiResponse(await this.sharedVaults.rename(user.id, id, body.name), 'Renamed');
  }

  @UseGuards(SharedVaultAccessGuard)
  @Post(':id/members')
  async invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Body(new ZodValidationPipe(inviteSharedVaultMembersInputSchema))
    body: InviteSharedVaultMembersInput,
  ) {
    return apiResponse(await this.sharedVaults.invite(user.id, id, body), 'Invitations sent');
  }

  @UseGuards(SharedVaultAccessGuard)
  @Post(':id/passcode')
  async changePasscode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Body(new ZodValidationPipe(changeSharedVaultPasscodeInputSchema))
    body: ChangeSharedVaultPasscodeInput,
  ) {
    return apiResponse(
      await this.sharedVaults.changePasscode(user.id, id, body),
      'Passcode changed',
    );
  }

  @UseGuards(SharedVaultAccessGuard)
  @Get(':id/items')
  listItems(@CurrentUser() user: AuthenticatedUser, @Param('id', VaultId()) id: string) {
    return this.sharedVaults.listItems(user.id, id);
  }

  @UseGuards(SharedVaultAccessGuard)
  @Post(':id/upload-url')
  requestUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Body(new ZodValidationPipe(requestSharedVaultUploadUrlInputSchema))
    body: RequestSharedVaultUploadUrlInput,
  ) {
    return this.sharedVaults.requestUploadUrl(user.id, id, body.contentType, body.sizeBytes);
  }

  @UseGuards(SharedVaultAccessGuard)
  @Post(':id/items')
  async createItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Body(new ZodValidationPipe(createSharedVaultItemInputSchema))
    body: CreateSharedVaultItemInput,
  ) {
    return apiResponse(await this.sharedVaults.createItem(user.id, id, body), 'Added');
  }

  @UseGuards(SharedVaultAccessGuard)
  @Delete(':id/items/:itemId')
  async deleteItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Param('itemId', VaultId()) itemId: string,
  ) {
    const result = await this.sharedVaults.deleteItem(user.id, id, itemId);
    return apiResponse(result, result.deleted ? 'Deleted' : 'Everyone has been asked');
  }

  @UseGuards(SharedVaultAccessGuard)
  @Delete(':id')
  async requestVaultDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
  ) {
    const result = await this.sharedVaults.requestVaultDeletion(user.id, id);
    return apiResponse(result, result.deleted ? 'Vault deleted' : 'Everyone has been asked');
  }

  @UseGuards(SharedVaultAccessGuard)
  @Get(':id/deletion-requests')
  listRequests(@CurrentUser() user: AuthenticatedUser, @Param('id', VaultId()) id: string) {
    return this.sharedVaults.listRequests(user.id, id);
  }

  @UseGuards(SharedVaultAccessGuard)
  @Post(':id/deletion-requests/:requestId/approve')
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Param('requestId', VaultId()) requestId: string,
  ) {
    const result = await this.sharedVaults.vote(user.id, id, requestId, true);
    return apiResponse(result, result.deleted ? 'Deleted' : 'Your answer is in');
  }

  @UseGuards(SharedVaultAccessGuard)
  @Post(':id/deletion-requests/:requestId/decline')
  async keep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Param('requestId', VaultId()) requestId: string,
  ) {
    return apiResponse(await this.sharedVaults.vote(user.id, id, requestId, false), 'Kept');
  }

  @UseGuards(SharedVaultAccessGuard)
  @Post(':id/deletion-requests/:requestId/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', VaultId()) id: string,
    @Param('requestId', VaultId()) requestId: string,
  ) {
    await this.sharedVaults.cancelRequest(user.id, id, requestId);
    return apiResponse('Request withdrawn');
  }
}
