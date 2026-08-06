import { timestamp } from 'drizzle-orm/pg-core';

/** Standard created_at/updated_at pair. updated_at is maintained by the app layer. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
};
