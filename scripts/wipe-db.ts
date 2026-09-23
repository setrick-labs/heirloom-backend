/**
 * Deletes every row from every app table. Destructive, irreversible from
 * this script's own perspective — take a backup first if you need one (see
 * _backup-all-tables.ts). Leaves the schema itself untouched (drizzle's own
 * migration-tracking table is not touched either), so no migration re-run
 * is needed afterward.
 *
 * Run with: pnpm exec tsx scripts/wipe-db.ts
 */
import { db, queryClient } from '../src/database/connection';
import {
  users,
  families,
  familyMembers,
  familyInvites,
  authTokens,
  aliases,
  journeys,
  journeyMembers,
  milestones,
  media,
  comments,
  reactions,
  vaultItems,
  gifts,
  contentViews,
  notifications,
  sharedVaults,
  sharedVaultMembers,
  sharedVaultItems,
  sharedVaultDeletionRequests,
  sharedVaultDeletionVotes,
} from '../src/database/schema';

// Children before parents, so no FK violation even without CASCADE.
const TABLES_IN_DELETE_ORDER = [
  // Polymorphic, references nothing but users — safe to clear first.
  { name: 'content_views', table: contentViews },
  { name: 'gifts', table: gifts },
  // Before media and users, both of which it points at.
  { name: 'notifications', table: notifications },
  // Shared Vaults, innermost first: votes hang off requests, everything else
  // off the vault, and the vault off its family.
  { name: 'shared_vault_deletion_votes', table: sharedVaultDeletionVotes },
  {
    name: 'shared_vault_deletion_requests',
    table: sharedVaultDeletionRequests,
  },
  { name: 'shared_vault_items', table: sharedVaultItems },
  { name: 'shared_vault_members', table: sharedVaultMembers },
  { name: 'shared_vaults', table: sharedVaults },
  { name: 'reactions', table: reactions },
  { name: 'comments', table: comments },
  { name: 'media', table: media },
  { name: 'milestones', table: milestones },
  { name: 'journey_members', table: journeyMembers },
  { name: 'journeys', table: journeys },
  { name: 'vault_items', table: vaultItems },
  { name: 'aliases', table: aliases },
  { name: 'auth_tokens', table: authTokens },
  { name: 'family_invites', table: familyInvites },
  { name: 'family_members', table: familyMembers },
  { name: 'families', table: families },
  { name: 'users', table: users },
];

async function main() {
  console.log('Wiping every row from every app table...\n');

  for (const { name, table } of TABLES_IN_DELETE_ORDER) {
    const deleted = await db.delete(table).returning({ id: table.id });
    console.log(`  ✓ ${name}: ${deleted.length} row(s) deleted`);
  }

  console.log('\nDone. Database is empty.');
  await queryClient.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('Wipe failed:', error);
  await queryClient.end();
  process.exit(1);
});
