/**
 * Finds image media rows whose variant/blurhash pass (MediaProcessingService,
 * fire-and-forget from MediaService.create()/MilestonesService.create())
 * never completed successfully, and reprocesses them:
 *
 *   - processing_status = 'failed' — the pass ran and threw.
 *   - processing_status = 'pending' for longer than STUCK_PENDING_MINUTES —
 *     the pass never got to run at all (e.g. the process was killed between
 *     the insert and the fire-and-forget call actually executing).
 *
 * No queue/cron wired up yet at current scale — run this by hand (or from
 * an external cron) after checking logs for processing warnings.
 *
 * Run with: pnpm run media:retry-failed
 */
import { eq, and, or, lt } from 'drizzle-orm';

import { db, queryClient } from '../src/database/connection';
import { media } from '../src/database/schema';
import { MediaProcessingService } from '../src/modules/media/media-processing.service';
import { StorageService } from '../src/shared/services/storage.service';

const STUCK_PENDING_MINUTES = 10;

async function main() {
  const storageService = new StorageService();
  const mediaProcessingService = new MediaProcessingService(db, storageService);

  const stuckPendingCutoff = new Date(
    Date.now() - STUCK_PENDING_MINUTES * 60_000,
  );
  const rows = await db.query.media.findMany({
    where: and(
      eq(media.type, 'image'),
      or(
        eq(media.processingStatus, 'failed'),
        and(
          eq(media.processingStatus, 'pending'),
          lt(media.createdAt, stuckPendingCutoff),
        ),
      ),
    ),
  });

  if (rows.length === 0) {
    console.log('No failed or stuck-pending media found.');
    await queryClient.end();
    return;
  }

  console.log(`Found ${rows.length} media item(s) to reprocess.`);
  const results = { done: 0, failed: 0 };

  for (const row of rows) {
    process.stdout.write(`  ${row.id} (${row.processingStatus}) ... `);
    await mediaProcessingService.processAndPersist(
      row.id,
      row.storageKey,
      row.type,
    );
    const [updated] = await db
      .select({ processingStatus: media.processingStatus })
      .from(media)
      .where(eq(media.id, row.id));
    if (updated?.processingStatus === 'done') {
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
