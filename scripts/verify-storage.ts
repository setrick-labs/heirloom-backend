/**
 * Exercises the real StorageService end to end against whatever S3-compatible
 * provider is configured in .env (SeaweedFS, MinIO, R2, real AWS S3 — same
 * code path either way): connection, upload, read-back, delete, and confirms
 * the delete actually took effect.
 *
 * Run with: pnpm run storage:verify
 */
import { StorageService } from '../src/shared/services/storage.service';

const TEST_CONTENT = `Heirloom storage verification — ${new Date().toISOString()}`;
const TEST_KEY = `_verify/${Date.now()}-verify.txt`;
const TEST_CONTENT_TYPE = 'text/plain';

interface StepResult {
  name: string;
  ok: boolean;
  detail?: string;
}

async function main() {
  const results: StepResult[] = [];
  const storage = new StorageService();

  const run = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = (await fn()) ?? undefined;
      results.push({ name, ok: true, detail });
      console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name, ok: false, detail: message });
      console.error(`✗ ${name} — ${message}`);
    }
  };

  await run('Connection (bucket reachable with configured credentials)', () =>
    storage.checkConnection(),
  );

  // Stop early if the connection itself failed — every later step would
  // just fail with the same underlying cause.
  if (!results[0].ok) {
    printSummary(results);
    process.exit(1);
  }

  let uploadUrl: string | undefined;
  await run('Generate presigned upload URL', async () => {
    uploadUrl = await storage.generatePresignedUploadUrl(
      TEST_KEY,
      TEST_CONTENT_TYPE,
    );
    return TEST_KEY;
  });

  await run('Upload via presigned URL', async () => {
    if (!uploadUrl) throw new Error('No upload URL (previous step failed)');
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': TEST_CONTENT_TYPE },
      body: TEST_CONTENT,
    });
    if (!response.ok) {
      throw new Error(
        `PUT failed with status ${response.status}: ${await response.text()}`,
      );
    }
  });

  let downloadUrl: string | undefined;
  await run('Read back via presigned download URL', async () => {
    downloadUrl = await storage.generatePresignedDownloadUrl(TEST_KEY);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`GET failed with status ${response.status}`);
    }
    const body = await response.text();
    if (body !== TEST_CONTENT) {
      throw new Error(
        `Downloaded content did not match what was uploaded (got: ${body.slice(0, 80)})`,
      );
    }
  });

  await run('Delete object', () => storage.deleteObject(TEST_KEY));

  await run('Confirm deletion (a GET now returns 404)', async () => {
    const confirmUrl = await storage.generatePresignedDownloadUrl(TEST_KEY);
    const response = await fetch(confirmUrl);
    if (response.status !== 404) {
      throw new Error(
        `Expected 404 after delete, got ${response.status} — the object may not actually be gone`,
      );
    }
  });

  printSummary(results);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

function printSummary(results: StepResult[]) {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (passed < results.length) {
    console.log('Failing steps:');
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
  }
}

main().catch((error) => {
  console.error('Unexpected error running storage verification:', error);
  process.exit(1);
});
