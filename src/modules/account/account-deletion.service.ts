import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNull, ne, or } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  aliases,
  authTokens,
  contentViews,
  families,
  familyInvites,
  familyMembers,
  journeyMembers,
  journeys,
  notifications,
  sharedVaultMembers,
  users,
  vaultItems,
} from '../../database/schema';
import { StorageService } from '../../shared/services/storage.service';
import { FamiliesService } from '../families/families.service';
import { SharedVaultsService } from '../shared-vaults/shared-vaults.service';

/** What a deleted account is called wherever its old contributions still show. */
export const FORMER_MEMBER_NAME = 'Former member';

const ADMIN_ROLES = new Set(['owner', 'admin']);

/**
 * Deleting an account (App Store guideline 5.1.1(v): an app that lets people
 * sign up must let them delete their account from inside it).
 *
 * Anonymised, not hard-deleted — the decision is recorded here because it is
 * the whole shape of this service. What someone shared with their family is
 * the family's history too: the photos, milestones, comments and likes stay,
 * credited to "Former member". Everything that is *theirs alone* goes: name,
 * email, phone, photo, password, sessions, private Vault and its files, their
 * notifications and read history.
 *
 * Anonymising is also what the schema allows. Families, journeys, milestones
 * and media all reference their creator with ON DELETE RESTRICT, so a real
 * DELETE of anyone who ever posted would fail — and the cascades on comments
 * and reactions would erase the conversation the family had around them.
 *
 * Nothing is left without an owner. A family passes to its longest-standing
 * admin, else its longest-standing member; a journey passes to its family's
 * owner; a shared vault goes through its own `leave()`, which already picks
 * an heir and closes the vault if nobody is left. A family with no one else
 * in it is deleted, exactly as leaving it would.
 *
 * Every step is safe to repeat. The steps span several services and can't
 * share one transaction, so if one fails part-way the password still works
 * (it is scrubbed last) and simply running the deletion again finishes it.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
    private readonly familiesService: FamiliesService,
    private readonly sharedVaultsService: SharedVaultsService,
  ) {}

  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user || user.status === 'deleted') {
      throw new NotFoundException('Account not found');
    }

    // Re-authenticate: an unlocked phone left on a table must not be enough
    // to erase someone's account.
    if (!(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: "That password isn't right.",
      });
    }

    await this.handOverFamilies(userId);
    await this.handOverJourneys(userId);
    await this.leaveSharedVaults(userId);
    await this.erasePrivateVault(userId);
    await this.erasePersonalRecords(userId);
    await this.anonymise(user);
  }

  /** Passes on any family they own or are the last admin of, then leaves it. */
  private async handOverFamilies(userId: string): Promise<void> {
    const memberships = await this.db
      .select({
        familyId: familyMembers.familyId,
        role: familyMembers.role,
        ownerId: families.ownerId,
      })
      .from(familyMembers)
      .innerJoin(families, eq(families.id, familyMembers.familyId))
      .where(and(eq(familyMembers.userId, userId), isNull(families.deletedAt)));

    for (const membership of memberships) {
      const others = await this.db
        .select({ userId: familyMembers.userId, role: familyMembers.role })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, membership.familyId),
            ne(familyMembers.userId, userId),
          ),
        )
        .orderBy(asc(familyMembers.joinedAt));

      if (others.length > 0) {
        // Admins first, then anyone — each group in joining order.
        const heir =
          others.find((row) => ADMIN_ROLES.has(row.role)) ??
          others.find((row) => row.role === 'member') ??
          others[0];

        if (membership.ownerId === userId || membership.role === 'owner') {
          await this.db.transaction(async (tx) => {
            await tx
              .update(families)
              .set({ ownerId: heir.userId, updatedAt: new Date() })
              .where(eq(families.id, membership.familyId));
            await tx
              .update(familyMembers)
              .set({ role: 'owner' })
              .where(
                and(
                  eq(familyMembers.familyId, membership.familyId),
                  eq(familyMembers.userId, heir.userId),
                ),
              );
          });
        } else if (
          ADMIN_ROLES.has(membership.role) &&
          !others.some((row) => ADMIN_ROLES.has(row.role))
        ) {
          // leaveFamily refuses to strand a family without an admin.
          await this.db
            .update(familyMembers)
            .set({ role: 'admin' })
            .where(
              and(
                eq(familyMembers.familyId, membership.familyId),
                eq(familyMembers.userId, heir.userId),
              ),
            );
        }
      }

      // The ordinary leave path from here: removes the membership and their
      // aliases, or deletes the family if they were its only member.
      await this.familiesService.leaveFamily(userId, membership.familyId);
    }

    // leaveFamily soft-deletes a family they were alone in but keeps that
    // membership row (its grace period can be cancelled). Nobody is left to
    // cancel it now, and an erased account shouldn't be listed anywhere.
    await this.db.delete(familyMembers).where(eq(familyMembers.userId, userId));

    // Codes they handed out stop working — a deleted account shouldn't keep
    // letting people in.
    await this.db
      .update(familyInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(familyInvites.createdBy, userId), isNull(familyInvites.revokedAt)),
      );
  }

  /** Each journey they own passes to its family's (possibly new) owner. */
  private async handOverJourneys(userId: string): Promise<void> {
    const owned = await this.db
      .select({ id: journeys.id, heirId: families.ownerId })
      .from(journeys)
      .innerJoin(families, eq(families.id, journeys.familyId))
      .where(
        and(
          eq(journeys.createdBy, userId),
          isNull(journeys.deletedAt),
          isNull(families.deletedAt),
        ),
      );

    for (const journey of owned) {
      // A family they were alone in is already deleted above, so the heir is
      // never the account being deleted.
      if (journey.heirId === userId) continue;
      await this.db.transaction(async (tx) => {
        await tx
          .update(journeys)
          .set({ createdBy: journey.heirId, updatedAt: new Date() })
          .where(eq(journeys.id, journey.id));
        // A 'selected'-visibility journey is only visible to its members —
        // make sure its new owner can still see what they now own.
        await tx
          .insert(journeyMembers)
          .values({ journeyId: journey.id, userId: journey.heirId })
          .onConflictDoNothing();
      });
    }

    await this.db.delete(journeyMembers).where(eq(journeyMembers.userId, userId));
  }

  private async leaveSharedVaults(userId: string): Promise<void> {
    const memberships = await this.db
      .select({ vaultId: sharedVaultMembers.vaultId })
      .from(sharedVaultMembers)
      .where(eq(sharedVaultMembers.userId, userId));

    // What they added stays for the others — see SharedVaultsService.leave.
    for (const { vaultId } of memberships) {
      await this.sharedVaultsService.leave(userId, vaultId);
    }
  }

  /** The private Vault is theirs alone: rows and files both go. */
  private async erasePrivateVault(userId: string): Promise<void> {
    const items = await this.db
      .delete(vaultItems)
      .where(eq(vaultItems.ownerId, userId))
      .returning({ storageKey: vaultItems.storageKey });

    for (const item of items) {
      try {
        await this.storageService.deleteObject(item.storageKey);
      } catch (error) {
        // An orphaned object costs storage, not privacy — nothing links to it.
        this.logger.warn(`Failed to delete vault object ${item.storageKey}: ${error}`);
      }
    }
  }

  private async erasePersonalRecords(userId: string): Promise<void> {
    await this.db.delete(authTokens).where(eq(authTokens.userId, userId));
    await this.db.delete(notifications).where(eq(notifications.recipientId, userId));
    await this.db.delete(contentViews).where(eq(contentViews.userId, userId));
    // Private renames, both the ones they gave others and others gave them.
    await this.db
      .delete(aliases)
      .where(or(eq(aliases.viewerUserId, userId), eq(aliases.subjectUserId, userId)));
  }

  /**
   * The row itself stays (it is what their family contributions point at),
   * emptied of everything that identifies them or could sign in as them.
   * Last, so a failure anywhere above leaves an account that can still
   * sign in and retry.
   */
  private async anonymise(user: typeof users.$inferSelect): Promise<void> {
    if (user.avatarStorageKey) {
      try {
        await this.storageService.deleteObject(user.avatarStorageKey);
      } catch (error) {
        this.logger.warn(`Failed to delete avatar for ${user.id}: ${error}`);
      }
    }

    await this.db
      .update(users)
      .set({
        // The row must keep an email or a phone (users_contact_check), and
        // email is unique — an address on a reserved, undeliverable domain
        // satisfies both without belonging to anyone.
        email: `deleted-${user.id}@deleted.invalid`,
        phone: null,
        name: FORMER_MEMBER_NAME,
        avatarUrl: null,
        avatarStorageKey: null,
        bio: null,
        status: 'deleted',
        // Random and discarded: no password can ever match it again.
        passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
        vaultPasswordHash: null,
        activeFamilyId: null,
        // Any access token already issued stops working immediately.
        sessionsInvalidatedAt: new Date(),
        vaultSessionsInvalidatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  }
}
