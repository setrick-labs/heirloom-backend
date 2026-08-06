import { pgTable, uuid, timestamp, unique } from 'drizzle-orm/pg-core';

import { familyRoleEnum } from './enums';
import { families } from './families';
import { users } from './users';

export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: familyRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('family_members_family_user_unique').on(
      table.familyId,
      table.userId,
    ),
  ],
);

export type FamilyMemberRow = typeof familyMembers.$inferSelect;
export type NewFamilyMemberRow = typeof familyMembers.$inferInsert;
