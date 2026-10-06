/**
 * Finds image and video media rows whose processing pass (MediaProcessingService,
 * fire-and-forget from MediaService.create()/MilestonesService.create())
 * never completed successfully, and reprocesses them:
 *
 *   - processing_status = 'failed' — the pass ran and threw.
 *   - processing_status = 'pending' for longer than STUCK_PENDING_MINUTES —
 *     the pass never got to run at all (e.g. the process was killed between
 *     the insert and the fire-and-forget call actually executing).
 *   - a video with no processing_status at all — uploaded before videos were
 *     processed, so it has no poster or streaming copy.
 *   - any Vault or shared-vault photo or video with no processing_status —
 *     uploaded before the Vaults were processed at all.
 *
 * Covers all three tables that hold processed media: `media`, `vault_items`
 * and `shared_vault_items`. Run once after deploying to backfill, then
 * whenever the logs show processing failures.
 *
 * No queue/cron wired up yet at current scale — run this by hand (or from
 * an external cron) after checking logs for processing warnings.
 *
 * Run with: pnpm run media:retry-failed
 */
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import { db, queryClient } from '../src/database/connection';
import { media, sharedVaultItems, vaultItems } from '../src/database/schema';
import {
  MediaProcessingService,
  type ProcessingTarget,
} from '../src/modules/media/media-processing.service';
import { StorageService } from '../src/shared/services/storage.service';

const STUCK_PENDING_MINUTES = 10;

type Candidate = {
  target: ProcessingTarget;
  id: string;
  storageKey: string;
  type: 'image' | 'video' | 'audio';
  processingStatus: 'pending' | 'done' | 'failed' | null;
};

/** Failed, stuck-pending, or (per `neverProcessed`) never processed at all. */
function needsWork(
  table: typeof media | typeof vaultItems | typeof sharedVaultItems,
  cutoff: Date,
  neverProcessed: ('image' | 'video')[],
) {
  return or(
    and(
      inArray(table.type, ['image', 'video']),
      or(
        eq(table.processingStatus, 'failed'),
        and(eq(table.processingStatus, 'pending'), lt(table.createdAt, cutoff)),
      ),
    ),
    and(inArray(table.type, neverProcessed), isNull(table.processingStatus)),
  );
}

async function findCandidates(cutoff: Date): Promise<Candidate[]> {
  const columns = {
    id: true,
    storageKey: true,
    type: true,
    processingStatus: true,
  } as const;
  const [mediaRows, vaultRows, sharedRows] = await Promise.all([
    // Family photos have always been processed; only videos predate it.
    db.query.media.findMany({
      columns,
      where: needsWork(media, cutoff, ['video']),
    }),
    db.query.vaultItems.findMany({
      columns,
      where: needsWork(vaultItems, cutoff, ['image', 'video']),
    }),
    db.query.sharedVaultItems.findMany({
      columns,
      where: needsWork(sharedVaultItems, cutoff, ['image', 'video']),
    }),
  ]);
  return [
    ...mediaRows.map((row) => ({ ...row, target: 'media' as const })),
    ...vaultRows.map((row) => ({ ...row, target: 'vault' as const })),
    ...sharedRows.map((row) => ({ ...row, target: 'sharedVault' as const })),
  ];
}

async function statusOf(candidate: Candidate) {
  const table =
    candidate.target === 'vault'
      ? vaultItems
      : candidate.target === 'sharedVault'
        ? sharedVaultItems
        : media;
  const [row] = await db
    .select({ processingStatus: table.processingStatus })
    .from(table)
    .where(eq(table.id, candidate.id));
  return row?.processingStatus ?? null;
}

async function main() {
  const storageService = new StorageService();
  const mediaProcessingService = new MediaProcessingService(db, storageService);

  const cutoff = new Date(Date.now() - STUCK_PENDING_MINUTES * 60_000);
  const candidates = await findCandidates(cutoff);

  if (candidates.length === 0) {
    console.log('No failed, stuck-pending or unprocessed media found.');
    await queryClient.end();
    return;
  }

  console.log(`Found ${candidates.length} item(s) to process.`);
  const results = { done: 0, failed: 0 };

  for (const candidate of candidates) {
    process.stdout.write(
      `  ${candidate.target} ${candidate.id} (${candidate.processingStatus ?? 'never'}) ... `,
    );
    await mediaProcessingService.processAndPersist(
      candidate.id,
      candidate.storageKey,
      candidate.type,
      candidate.target,
    );
    if ((await statusOf(candidate)) === 'done') {
      results.done += 1;
      console.log('done');
    } else {
      results.failed += 1;
      console.log('still failed');
    }
  }

  console.log(`\n${results.done} succeeded, ${results.failed} still failing.`);
  await queryClient.end();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('Unexpected error retrying failed media:', error);
  await queryClient.end();
  process.exit(1);
});
