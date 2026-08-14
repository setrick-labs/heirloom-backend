/**
 * Populates an EMPTY database with a large, varied dataset — 3 families,
 * 12 users, a dozen journeys, ~80 milestones, ~100 real uploaded photos
 * (processed through the same MediaProcessingService pipeline the live app
 * uses, so thumbnails/blurhash are genuinely populated, not stubbed),
 * comments, reactions, gifts in every status, a couple of vault items, and
 * a couple of private aliases.
 *
 * Refuses to run against a non-empty database (see `assertEmpty` below) —
 * run `pnpm run db:wipe` first if you want a clean slate.
 *
 * Run with: pnpm run db:seed
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
  aliases,
  journeys,
  journeyMembers,
  milestones,
  media,
  reactions,
  comments,
  gifts,
  vaultItems,
} from '../src/database/schema';
import { MediaProcessingService } from '../src/modules/media/media-processing.service';
import { StorageKeys } from '../src/shared/services/storage-keys.util';
import { StorageService } from '../src/shared/services/storage.service';

const SEED_PASSWORD = 'Seed1234!';
const VAULT_PASSWORD = 'SeedVault1234!';
const SEED_ASSETS_DIR = `${__dirname}/seed-assets`;
const IMAGE_CONTENT_TYPE = 'image/jpeg';
const IMAGE_WIDTH = 1024;
const IMAGE_HEIGHT = 768;
const DAY_MS = 24 * 60 * 60 * 1000;

// One entry per generated placeholder photo (scripts/seed-assets/seed-NN-*.jpg).
// title/description/location double as milestone content — reused round-robin
// across every journey below, so titles legitimately repeat across families
// (as they would in real life: everyone has a "Beach Day").
const THEMES = [
  {
    file: 'seed-00-hospital-day.jpg',
    title: 'Hospital Day',
    description: 'The day our world got a little bigger.',
    location: 'General Hospital',
  },
  {
    file: 'seed-01-first-smile.jpg',
    title: 'First Smile',
    description: 'Six weeks in and already melting hearts.',
    location: 'Home',
  },
  {
    file: 'seed-02-first-steps.jpg',
    title: 'First Steps',
    description: 'Wobbly, brief, and absolutely unforgettable.',
    location: 'Living room',
  },
  {
    file: 'seed-03-garden-picnic.jpg',
    title: 'Garden Picnic',
    description: 'Blankets on the grass, way too much food.',
    location: 'Backyard',
  },
  {
    file: 'seed-04-berry-picking.jpg',
    title: 'Berry Picking',
    description: 'Purple fingers, purple mouths, worth it.',
    location: 'Local farm',
  },
  {
    file: 'seed-05-birthday-cake.jpg',
    title: 'Birthday Cake',
    description: 'One candle away from a house fire, as tradition demands.',
    location: 'Home',
  },
  {
    file: 'seed-06-beach-day.jpg',
    title: 'Beach Day',
    description: 'Sand everywhere. Worth it.',
    location: 'The beach',
  },
  {
    file: 'seed-07-snow-day.jpg',
    title: 'Snow Day',
    description: 'School was cancelled and nobody complained.',
    location: 'Front yard',
  },
  {
    file: 'seed-08-first-day-of-school.jpg',
    title: 'First Day of School',
    description: 'New backpack, nervous smile, big year ahead.',
    location: 'Elementary school',
  },
  {
    file: 'seed-09-graduation.jpg',
    title: 'Graduation',
    description: 'Cap thrown, tears not entirely hidden.',
    location: 'The auditorium',
  },
  {
    file: 'seed-10-road-trip.jpg',
    title: 'Road Trip',
    description: 'Three wrong turns and one great playlist.',
    location: 'Somewhere on I-90',
  },
  {
    file: 'seed-11-campfire-night.jpg',
    title: 'Campfire Night',
    description: 'Burnt marshmallows, better stories.',
    location: 'Campground',
  },
  {
    file: 'seed-12-family-dinner.jpg',
    title: 'Family Dinner',
    description: 'Everyone at the table at the same time — a small miracle.',
    location: 'Dining room',
  },
  {
    file: 'seed-13-new-puppy.jpg',
    title: 'New Puppy',
    description: 'Chaos, immediately and completely worth it.',
    location: 'Home',
  },
  {
    file: 'seed-14-halloween.jpg',
    title: 'Halloween',
    description: 'The costume took three weekends. Nobody regrets it.',
    location: 'The neighborhood',
  },
  {
    file: 'seed-15-christmas-morning.jpg',
    title: 'Christmas Morning',
    description: 'Wrapping paper as far as the eye can see.',
    location: 'Living room',
  },
  {
    file: 'seed-16-piano-recital.jpg',
    title: 'Piano Recital',
    description: 'Only one wrong note — nobody noticed but us.',
    location: 'Community hall',
  },
  {
    file: 'seed-17-soccer-game.jpg',
    title: 'Soccer Game',
    description: 'The whole sideline lost their voices cheering.',
    location: 'Municipal field',
  },
  {
    file: 'seed-18-grandpas-workshop.jpg',
    title: "Grandpa's Workshop",
    description: 'Sawdust, patience, and a birdhouse that mostly works.',
    location: "Grandpa's garage",
  },
  {
    file: 'seed-19-baking-sunday.jpg',
    title: 'Baking Sunday',
    description: 'More flour on the counter than in the bowl.',
    location: 'Kitchen',
  },
  {
    file: 'seed-20-lake-house.jpg',
    title: 'Lake House',
    description: 'A week that always feels too short.',
    location: 'The lake house',
  },
  {
    file: 'seed-21-backyard-camping.jpg',
    title: 'Backyard Camping',
    description: 'Made it two hours before someone wanted the bathroom.',
    location: 'Backyard',
  },
  {
    file: 'seed-22-wedding-day.jpg',
    title: 'Wedding Day',
    description: 'Every version of happy, all at once.',
    location: 'The venue',
  },
  {
    file: 'seed-23-anniversary-trip.jpg',
    title: 'Anniversary Trip',
    description: 'Same two people, a few more years in.',
    location: 'Somewhere far from home',
  },
  {
    file: 'seed-24-reading-time.jpg',
    title: 'Reading Time',
    description: 'The same book, requested for the tenth night running.',
    location: 'Bedroom',
  },
  {
    file: 'seed-25-morning-walk.jpg',
    title: 'Morning Walk',
    description: 'The kind of quiet that only exists before 7am.',
    location: 'The park',
  },
  {
    file: 'seed-26-cousins-reunion.jpg',
    title: 'Cousins Reunion',
    description: 'Loud, chaotic, exactly right.',
    location: "Grandma's house",
  },
  {
    file: 'seed-27-fishing-trip.jpg',
    title: 'Fishing Trip',
    description: 'Caught one fish. Told the story like it was ten.',
    location: 'The river',
  },
  {
    file: 'seed-28-ice-cream-run.jpg',
    title: 'Ice Cream Run',
    description: 'A spontaneous decision that was correct in every way.',
    location: 'Corner shop',
  },
  {
    file: 'seed-29-talent-show.jpg',
    title: 'Talent Show',
    description: 'Bravery in its purest, most off-key form.',
    location: 'School gym',
  },
];

const REACTION_EMOJIS = ['❤️', '😍', '😂', '👏', '🥹', '🙌'];

interface UserPlan {
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  bio?: string;
}

interface JourneyPlan {
  title: string;
  description: string;
  visibility: 'all' | 'selected';
  selectedMemberIndexes?: number[];
  milestoneCount: number;
}

interface FamilyPlan {
  name: string;
  members: UserPlan[];
  journeys: JourneyPlan[];
  vaultOwnerIndex: number;
}

const FAMILY_PLANS: FamilyPlan[] = [
  {
    name: 'The Alvarez-Reyes Family',
    vaultOwnerIndex: 0,
    members: [
      {
        name: 'Sofia Alvarez',
        email: 'sofia.alvarez@heirloom.test',
        role: 'owner',
        bio: 'Keeper of every family photo since 2003.',
      },
      {
        name: 'Marcus Alvarez',
        email: 'marcus.alvarez@heirloom.test',
        role: 'admin',
      },
      {
        name: 'Elena Reyes',
        email: 'elena.reyes@heirloom.test',
        role: 'member',
      },
      {
        name: 'Diego Alvarez',
        email: 'diego.alvarez@heirloom.test',
        role: 'member',
      },
    ],
    journeys: [
      {
        title: "Sofia & Marcus's Wedding Year",
        description: 'From engagement to "I do" and everything after.',
        visibility: 'all',
        milestoneCount: 7,
      },
      {
        title: "Diego's Growing Up",
        description: 'Every first, kept in one place.',
        visibility: 'all',
        milestoneCount: 8,
      },
      {
        title: 'Sunday Family Dinners',
        description: 'The one tradition nobody skips.',
        visibility: 'all',
        milestoneCount: 5,
      },
      {
        title: 'Just the Two of Us',
        description: "Sofia and Marcus's private trips.",
        visibility: 'selected',
        selectedMemberIndexes: [1],
        milestoneCount: 4,
      },
    ],
  },
  {
    name: 'The Okafor Family',
    vaultOwnerIndex: 0,
    members: [
      {
        name: 'Ngozi Okafor',
        email: 'ngozi.okafor@heirloom.test',
        role: 'owner',
        bio: 'Lagos to London, and everywhere in between.',
      },
      {
        name: 'Chidi Okafor',
        email: 'chidi.okafor@heirloom.test',
        role: 'admin',
      },
      {
        name: 'Amara Okafor',
        email: 'amara.okafor@heirloom.test',
        role: 'member',
      },
    ],
    journeys: [
      {
        title: "Amara's First Year",
        description: 'Every first, kept in one place.',
        visibility: 'all',
        milestoneCount: 6,
      },
      {
        title: 'Okafor Family Christmases',
        description: 'A new one every year, somehow all the same.',
        visibility: 'all',
        milestoneCount: 6,
      },
      {
        title: "Chidi's School Years",
        description: 'From first day to graduation day.',
        visibility: 'all',
        milestoneCount: 7,
      },
      {
        title: 'Lagos to London',
        description: 'The move, the visits, the two homes.',
        visibility: 'selected',
        selectedMemberIndexes: [1, 2],
        milestoneCount: 5,
      },
    ],
  },
  {
    name: 'The Kim-Patel Family',
    vaultOwnerIndex: 0,
    members: [
      {
        name: 'Grace Kim',
        email: 'grace.kim@heirloom.test',
        role: 'owner',
        bio: 'Two families, one big one.',
      },
      { name: 'David Kim', email: 'david.kim@heirloom.test', role: 'admin' },
      {
        name: 'Priya Patel',
        email: 'priya.patel@heirloom.test',
        role: 'member',
      },
      { name: 'Raj Patel', email: 'raj.patel@heirloom.test', role: 'member' },
      { name: 'Mina Kim', email: 'mina.kim@heirloom.test', role: 'member' },
    ],
    journeys: [
      {
        title: "Mina's Growing Up",
        description: 'Every first, kept in one place.',
        visibility: 'all',
        milestoneCount: 8,
      },
      {
        title: 'The Kim-Patel Wedding',
        description: 'Two families becoming one.',
        visibility: 'all',
        milestoneCount: 6,
      },
      {
        title: "Grandparents' Visits",
        description: 'Every trip they made to see us.',
        visibility: 'all',
        milestoneCount: 5,
      },
      {
        title: 'Diwali & Chuseok',
        description: 'Both traditions, every year.',
        visibility: 'selected',
        selectedMemberIndexes: [2, 3],
        milestoneCount: 5,
      },
    ],
  },
];

let themeCursor = 0;
function nextTheme() {
  const theme = THEMES[themeCursor % THEMES.length];
  themeCursor++;
  return theme;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

async function assertEmpty() {
  const existing = await db.query.users.findFirst();
  if (existing) {
    console.error(
      `Database is not empty (found user ${existing.id}). Refusing to seed on top of existing data — run "pnpm run db:wipe" first.`,
    );
    process.exit(1);
  }
}

async function main() {
  await assertEmpty();

  const storage = new StorageService();
  const mediaProcessing = new MediaProcessingService(db, storage);
  const passwordHash = await argon2.hash(SEED_PASSWORD);
  const vaultPasswordHash = await argon2.hash(VAULT_PASSWORD);

  let userCount = 0;
  let familyCount = 0;
  let journeyCount = 0;
  let milestoneCount = 0;
  let photoCount = 0;
  let commentCount = 0;
  let reactionCount = 0;
  let vaultItemCount = 0;

  for (const familyPlan of FAMILY_PLANS) {
    console.log(`\n=== ${familyPlan.name} ===`);

    const createdMembers: { id: string; name: string; role: string }[] = [];
    for (const memberPlan of familyPlan.members) {
      const [user] = await db
        .insert(users)
        .values({
          email: memberPlan.email,
          passwordHash,
          name: memberPlan.name,
          bio: memberPlan.bio,
          status: 'active',
          vaultPasswordHash: undefined,
        })
        .returning();
      createdMembers.push({
        id: user.id,
        name: user.name,
        role: memberPlan.role,
      });
      userCount++;
      console.log(`  ✓ User: ${user.name} (${memberPlan.email})`);
    }

    const owner = createdMembers[0];
    const [family] = await db
      .insert(families)
      .values({ name: familyPlan.name, ownerId: owner.id })
      .returning();
    familyCount++;
    console.log(`  ✓ Family: ${family.name}`);

    for (const member of createdMembers) {
      await db.insert(familyMembers).values({
        familyId: family.id,
        userId: member.id,
        role: member.role as 'owner' | 'admin' | 'member',
      });
    }
    for (const member of createdMembers) {
      await db
        .update(users)
        .set({ activeFamilyId: family.id })
        .where(eq(users.id, member.id));
    }

    // A private nickname or two, to exercise the alias feature.
    if (createdMembers.length >= 2) {
      await db.insert(aliases).values({
        familyId: family.id,
        subjectUserId: createdMembers[1].id,
        viewerUserId: owner.id,
        nickname: createdMembers[1].name.split(' ')[0] + ' 💛',
      });
    }

    // A couple of private Vault photos for the designated member.
    const vaultOwner = createdMembers[familyPlan.vaultOwnerIndex];
    await db
      .update(users)
      .set({ vaultPasswordHash })
      .where(eq(users.id, vaultOwner.id));
    for (let i = 0; i < 2; i++) {
      const theme = nextTheme();
      const fileBuffer = readFileSync(`${SEED_ASSETS_DIR}/${theme.file}`);
      const key = StorageKeys.vaultItem({
        userId: vaultOwner.id,
        extension: 'jpg',
      });
      const uploadUrl = await storage.generatePresignedUploadUrl(
        key,
        IMAGE_CONTENT_TYPE,
      );
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': IMAGE_CONTENT_TYPE },
        body: fileBuffer,
      });
      if (!res.ok) throw new Error(`Vault upload failed: ${res.status}`);
      await db.insert(vaultItems).values({
        ownerId: vaultOwner.id,
        type: 'image',
        storageKey: key,
        caption: `Private — ${theme.title}`,
        sizeBytes: fileBuffer.byteLength,
      });
      vaultItemCount++;
    }
    console.log(`  ✓ Vault: 2 private photos for ${vaultOwner.name}`);

    for (const journeyPlan of familyPlan.journeys) {
      const [journey] = await db
        .insert(journeys)
        .values({
          familyId: family.id,
          title: journeyPlan.title,
          description: journeyPlan.description,
          visibilityType: journeyPlan.visibility,
          createdBy: owner.id,
        })
        .returning();
      journeyCount++;

      if (
        journeyPlan.visibility === 'selected' &&
        journeyPlan.selectedMemberIndexes
      ) {
        for (const idx of journeyPlan.selectedMemberIndexes) {
          await db.insert(journeyMembers).values({
            journeyId: journey.id,
            userId: createdMembers[idx].id,
          });
        }
      }
      console.log(
        `  ✓ Journey: ${journey.title} (${journeyPlan.milestoneCount} milestones)`,
      );

      for (let m = 0; m < journeyPlan.milestoneCount; m++) {
        const theme = nextTheme();
        const milestoneId = randomUUID();
        const daysAgo = randomInt(5, 900);
        const date = new Date(Date.now() - daysAgo * DAY_MS);
        const creator = pick(createdMembers);

        await db.insert(milestones).values({
          id: milestoneId,
          journeyId: journey.id,
          title: theme.title,
          description: theme.description,
          location: theme.location,
          date,
          createdBy: creator.id,
        });
        milestoneCount++;

        // ~30% of milestones get a second photo, for volume + realism.
        const photoThemes =
          Math.random() < 0.3 ? [theme, nextTheme()] : [theme];
        const mediaIds: string[] = [];

        for (const photoTheme of photoThemes) {
          const fileBuffer = readFileSync(
            `${SEED_ASSETS_DIR}/${photoTheme.file}`,
          );
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
          const res = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': IMAGE_CONTENT_TYPE },
            body: fileBuffer,
          });
          if (!res.ok)
            throw new Error(
              `Upload failed for ${photoTheme.file}: ${res.status}`,
            );

          const [mediaRow] = await db
            .insert(media)
            .values({
              familyId: family.id,
              ownerId: creator.id,
              milestoneId,
              type: 'image',
              storageKey: key,
              width: IMAGE_WIDTH,
              height: IMAGE_HEIGHT,
              sizeBytes: fileBuffer.byteLength,
              processingStatus: 'pending',
            })
            .returning();
          mediaIds.push(mediaRow.id);
          photoCount++;

          // Sequential, not fire-and-forget — this is an offline batch job,
          // not a request handler, so there's no latency budget to protect
          // and sequential keeps console output/order sane.
          await mediaProcessing.processAndPersist(mediaRow.id, key, 'image');
        }
        process.stdout.write(
          `    ✓ ${theme.title} (${photoThemes.length} photo${photoThemes.length > 1 ? 's' : ''})\r\n`,
        );

        // Reactions from a random subset of other members.
        const reactors = createdMembers.filter((mem) => mem.id !== creator.id);
        for (const reactor of reactors) {
          if (Math.random() < 0.5) {
            await db.insert(reactions).values({
              targetType: 'media',
              targetId: pick(mediaIds),
              userId: reactor.id,
              emoji: pick(REACTION_EMOJIS),
            });
            reactionCount++;
          }
        }

        // A text comment about a third of the time, from someone else.
        if (reactors.length > 0 && Math.random() < 0.35) {
          const commenter = pick(reactors);
          await db.insert(comments).values({
            targetType: 'media',
            targetId: pick(mediaIds),
            authorId: commenter.id,
            type: 'text',
            body: pick([
              'This one made my day.',
              'I still think about this one.',
              'Look how much has changed since then!',
              'One of my favorites.',
              "Can't believe how fast this went by.",
              'Saving this one forever.',
            ]),
          });
          commentCount++;
        }
      }
    }
  }

  // Gifts — one of each status, sent between families so a recipient's
  // Gifts tab actually has something to show.
  const familyOwners = await db.query.families.findMany();
  const journeysByFamily = await db.query.journeys.findMany();

  const giftPlans: {
    fromFamilyIdx: number;
    toFamilyIdx: number;
    daysOffset: number;
    opened: boolean;
    cancelled: boolean;
  }[] = [
    {
      fromFamilyIdx: 0,
      toFamilyIdx: 1,
      daysOffset: -30,
      opened: true,
      cancelled: false,
    },
    {
      fromFamilyIdx: 1,
      toFamilyIdx: 2,
      daysOffset: -5,
      opened: false,
      cancelled: false,
    },
    {
      fromFamilyIdx: 2,
      toFamilyIdx: 0,
      daysOffset: 20,
      opened: false,
      cancelled: false,
    },
    {
      fromFamilyIdx: 0,
      toFamilyIdx: 2,
      daysOffset: 60,
      opened: false,
      cancelled: true,
    },
  ];

  for (const plan of giftPlans) {
    const fromFamily = familyOwners[plan.fromFamilyIdx];
    const fromJourney = journeysByFamily.find(
      (j) => j.familyId === fromFamily.id,
    );
    const toOwnerEmail = FAMILY_PLANS[plan.toFamilyIdx].members[0].email;
    if (!fromJourney) continue;

    const unlockDate = new Date(Date.now() + plan.daysOffset * DAY_MS);
    await db.insert(gifts).values({
      journeyId: fromJourney.id,
      fromUserId: fromFamily.ownerId,
      recipientEmail: toOwnerEmail,
      message: 'A journey I wanted to share with you.',
      unlockDate,
      cancelledAt: plan.cancelled ? new Date() : undefined,
      firstOpenedAt: plan.opened ? new Date() : undefined,
    });
  }
  console.log(
    `\n✓ Gifts: ${giftPlans.length} (mixed pending/unlocked/opened/cancelled)`,
  );

  console.log('\nDone.');
  console.log('─'.repeat(56));
  console.log(`  Families:    ${familyCount}`);
  console.log(`  Users:       ${userCount}`);
  console.log(`  Journeys:    ${journeyCount}`);
  console.log(`  Milestones:  ${milestoneCount}`);
  console.log(`  Photos:      ${photoCount}`);
  console.log(`  Comments:    ${commentCount}`);
  console.log(`  Reactions:   ${reactionCount}`);
  console.log(`  Vault items: ${vaultItemCount}`);
  console.log(`  Gifts:       ${giftPlans.length}`);
  console.log('─'.repeat(56));
  console.log(`  Shared password (all accounts): ${SEED_PASSWORD}`);
  console.log(`  Vault password (owner of each family): ${VAULT_PASSWORD}`);
  console.log('─'.repeat(56));
  for (const familyPlan of FAMILY_PLANS) {
    console.log(`  ${familyPlan.name}:`);
    for (const m of familyPlan.members) {
      console.log(`    ${m.email}  (${m.role})`);
    }
  }
  console.log('─'.repeat(56));

  await queryClient.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('Seed failed:', error);
  await queryClient.end();
  process.exit(1);
});
