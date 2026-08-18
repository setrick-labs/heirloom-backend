import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';

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
    /**
     * The name this member chose for THIS family to see them by ("Set Your
     * Nickname", flow Screen 14) — public within the family, and only the
     * member themselves can change it (Screen 34: their own row reads
     * "Edit · this is how everyone sees you").
     *
     * Deliberately NOT the same thing as an `aliases` row, which is the
     * private, per-viewer rename from Screen 35. Both can exist for one
     * person at once and they answer different questions; see
     * shared/utils/display-name.util.ts for the resolution order.
     *
     * Null means "never set one" — fall back to users.name.
     */
    nickname: varchar('nickname', { length: 120 }),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('family_members_family_user_unique').on(
      table.familyId,
      table.userId,
    ),
    // The unique above leads with family_id, so it can't serve the
    // user_id-only lookups on the hottest path in the app: "which families
    // am I in" (families.listForUser, resolveActiveFamilyId), which runs on
    // essentially every app open.
    index('family_members_user_id_idx').on(table.userId),
  ],
);

export type FamilyMemberRow = typeof familyMembers.$inferSelect;
export type NewFamilyMemberRow = typeof familyMembers.$inferInsert;
