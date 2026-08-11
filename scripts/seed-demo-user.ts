/**
 * Creates ONE new demo user with a fully populated family (a couple of
 * journeys, milestones, real uploaded photos, a reaction, and a comment) —
 * scoped entirely to that user. Touches nothing belonging to any existing
 * account; aborts up front if the demo email is already taken instead of
 * risking a collision.
 *
 * Run with: pnpm run seed:demo-user
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';

import { db, queryClient } from '../src/database/connection';
import {
  users,
  families,
  familyMembers,
  journeys,
  milestones,
  media,
  reactions,
  comments,
} from '../src/database/schema';
import { StorageKeys } from '../src/shared/services/storage-keys.util';
import { StorageService } from '../src/shared/services/storage.service';

const DEMO_EMAIL = 'demo@heirloom.app';
const DEMO_PASSWORD = 'Demo1234!';
const DEMO_VAULT_PASSWORD = 'VaultDemo1234!';
const DEMO_NAME = 'Demo User';
const FAMILY_NAME = 'The Demo Family';

const SEED_ASSETS_DIR = `${__dirname}/seed-assets`;
const IMAGE_CONTENT_TYPE = 'image/jpeg';
const IMAGE_WIDTH = 1024;
const IMAGE_HEIGHT = 768;

interface MilestoneSeed {
  title: string;
  description: string;
  location: string;
  daysAgo: number;
  imageFile: string;
  reaction?: string;
  comment?: string;
}

interface JourneySeed {
  title: string;
  description: string;
  milestones: MilestoneSeed[];
}

const JOURNEYS: JourneySeed[] = [
  {
    title: "Amara's First Year",
    description: 'Every first, kept in one place.',
    milestones: [
      {
        title: 'Hospital Day',
        description: 'The day our world got a little bigger.',
        location: 'St. Mary General Hospital',
        daysAgo: 300,
        imageFile: 'hospital-day.jpg',
        reaction: '❤️',
        comment: 'The best day of my life. Welcome, Amara.',
      },
      {
        title: 'First Smile',
        description: 'Six weeks in and already melting hearts.',
        location: 'Home',
        daysAgo: 250,
        imageFile: 'first-smile.jpg',
        reaction: '😍',
      },
      {
        title: 'First Steps',
        description: 'Wobbly, brief, and absolutely unforgettable.',
        location: 'Living room',
        daysAgo: 60,
        imageFile: 'first-steps.jpg',
        reaction: '👏',
        comment: "Caught it on camera just in time — she's off!",
      },
    ],
  },
  {
    title: "Nani's Garden Summers",
    description: 'Long afternoons in Nani’s backyard.',
    milestones: [
      {
        title: 'Garden Picnic',
        description: 'Blankets on the grass, way too much food.',
        location: "Nani's backyard",
        daysAgo: 40,
        imageFile: 'garden-picnic.jpg',
        reaction: '❤️',
      },
      {
        title: 'Berry Picking',
        description: 'Purple fingers, purple mouths, worth it.',
        location: "Nani's garden",
        daysAgo: 20,
        imageFile: 'berry-picking.jpg',
      },
    ],
  },
];

async function main() {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, DEMO_EMAIL),
  });
  if (existing) {
    console.error(
      `A user with ${DEMO_EMAIL} already exists (id: ${existing.id}). ` +
        'Refusing to create a duplicate — delete that account first if you want to reseed.',
    );
    process.exit(1);
  }

  const storage = new StorageService();
  const [accountPasswordHash, vaultPasswordHash] = await Promise.all([
    argon2.hash(DEMO_PASSWORD),
    argon2.hash(DEMO_VAULT_PASSWORD),
  ]);

  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      passwordHash: accountPasswordHash,
      name: DEMO_NAME,
      status: 'active', // skips email verification entirely
      vaultPasswordHash, // vault is pre-set-up too
    })
    .returning();
  console.log(`✓ Created user ${user.id} (${user.email})`);

  const [family] = await db
    .insert(families)
    .values({ name: FAMILY_NAME, ownerId: user.id })
    .returning();
  console.log(`✓ Created family ${family.id} (${family.name})`);

  await db.insert(familyMembers).values({
    familyId: family.id,
    userId: user.id,
    role: 'owner',
  });

  await db
    .update(users)
    .set({ activeFamilyId: family.id })
    .where(eq(users.id, user.id));
  console.log('✓ Set active family');

  let journeyCount = 0;
  let milestoneCount = 0;
  let mediaCount = 0;

  for (const journeySeed of JOURNEYS) {
    const [journey] = await db
      .insert(journeys)
      .values({
        familyId: family.id,
        title: journeySeed.title,
        description: journeySeed.description,
        visibilityType: 'all',
        createdBy: user.id,
      })
      .returning();
    journeyCount++;
    console.log(`  ✓ Journey: ${journey.title}`);

    for (const ms of journeySeed.milestones) {
      const milestoneId = randomUUID();
      const date = new Date(Date.now() - ms.daysAgo * 24 * 60 * 60 * 1000);

      await db.insert(milestones).values({
        id: milestoneId,
        journeyId: journey.id,
        title: ms.title,
        description: ms.description,
        location: ms.location,
        date,
        createdBy: user.id,
      });
      milestoneCount++;

      // Upload the real placeholder photo through the same presigned-URL
      // path the app itself uses, so this isn't a fake storageKey pointing
      // at nothing — the image genuinely resolves in the app.
      const fileBuffer = readFileSync(`${SEED_ASSETS_DIR}/${ms.imageFile}`);
      const key = StorageKeys.journeyMedia({
        familyId: family.id,
        journeyId: journey.id,
        milestoneId,
        extension: 'jpg',
      });
      const uploadUrl = await storage.generatePresignedUploadUrl(
        key,
        IMAGE_CONTENT_TYPE,
      );
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': IMAGE_CONTENT_TYPE },
        body: fileBuffer,
      });
      if (!uploadResponse.ok) {
        throw new Error(
          `Upload failed for ${ms.imageFile}: ${uploadResponse.status} ${await uploadResponse.text()}`,
        );
      }

      const [mediaRow] = await db
        .insert(media)
        .values({
          familyId: family.id,
          ownerId: user.id,
          milestoneId,
          type: 'image',
          storageKey: key,
          width: IMAGE_WIDTH,
          height: IMAGE_HEIGHT,
          sizeBytes: fileBuffer.byteLength,
        })
        .returning();
      mediaCount++;
      console.log(`    ✓ Milestone: ${ms.title} (photo uploaded)`);

      if (ms.reaction) {
        await db.insert(reactions).values({
          targetType: 'media',
          targetId: mediaRow.id,
          userId: user.id,
          emoji: ms.reaction,
        });
      }
      if (ms.comment) {
        await db.insert(comments).values({
          targetType: 'media',
          targetId: mediaRow.id,
          authorId: user.id,
          type: 'text',
          body: ms.comment,
        });
      }
    }
  }

  console.log('\nDone.');
  console.log('─'.repeat(48));
  console.log(`  Email:          ${DEMO_EMAIL}`);
  console.log(`  Password:       ${DEMO_PASSWORD}`);
  console.log(`  Vault password: ${DEMO_VAULT_PASSWORD}`);
  console.log(`  Family:         ${FAMILY_NAME}`);
  console.log(`  Journeys:       ${journeyCount}`);
  console.log(`  Milestones:     ${milestoneCount}`);
  console.log(`  Photos:         ${mediaCount}`);
  console.log('─'.repeat(48));

  await queryClient.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('Seed failed:', error);
  await queryClient.end();
  process.exit(1);
});
