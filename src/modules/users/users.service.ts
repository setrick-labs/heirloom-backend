import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { users } from '../../database/schema';
import {
  getFamilyMembership,
  isActiveFamilyMember,
  resolveActiveFamilyId,
} from '../../shared/utils/family-membership.util';
import {
  SwitchActiveFamilyInput,
  UpdateUserInput,
  User,
} from './validations/user.schema';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async findById(id: string): Promise<User> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Self-heals a stale activeFamilyId (e.g. removed from what had been
    // their active family) on every /users/me call — the guaranteed
    // "next app interaction" the family functional spec asks for, beyond
    // whatever proactive fix the action that caused it already attempted.
    const resolvedActiveFamilyId = await resolveActiveFamilyId(
      this.db,
      id,
      user.activeFamilyId,
    );
    if (resolvedActiveFamilyId !== user.activeFamilyId) {
      const [healed] = await this.db
        .update(users)
        .set({ activeFamilyId: resolvedActiveFamilyId })
        .where(eq(users.id, id))
        .returning();
      return this.toDto(healed);
    }

    return this.toDto(user);
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const [updated] = await this.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return this.toDto(updated);
  }

  /** Section 6: switching families — must already be a member, this doesn't join. */
  async switchActiveFamily(
    userId: string,
    input: SwitchActiveFamilyInput,
  ): Promise<User> {
    const isMember = await isActiveFamilyMember(
      this.db,
      userId,
      input.familyId,
    );
    if (!isMember) {
      throw new ForbiddenException('You are not a member of that family');
    }

    const [updated] = await this.db
      .update(users)
      .set({ activeFamilyId: input.familyId, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    return this.toDto(updated);
  }

  private async toDto(row: typeof users.$inferSelect): Promise<User> {
    const membership = row.activeFamilyId
      ? await getFamilyMembership(this.db, row.id, row.activeFamilyId)
      : undefined;

    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      name: row.name,
      avatarUrl: row.avatarUrl,
      bio: row.bio,
      role: membership?.role ?? 'member',
      activeFamilyId: row.activeFamilyId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
