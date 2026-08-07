-- Gifting spec: gifts must target a Journey (not an arbitrary family/media
-- item) and reach a recipient by email who may not have an account yet.
-- Table has zero rows in every environment so far — safe to drop and
-- recreate the affected columns rather than migrate data.
ALTER TABLE "gifts" DROP CONSTRAINT IF EXISTS "gifts_family_id_families_id_fk";--> statement-breakpoint
ALTER TABLE "gifts" DROP CONSTRAINT IF EXISTS "gifts_to_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "gifts" DROP CONSTRAINT IF EXISTS "gifts_media_id_media_id_fk";--> statement-breakpoint
ALTER TABLE "gifts" DROP COLUMN IF EXISTS "family_id";--> statement-breakpoint
ALTER TABLE "gifts" DROP COLUMN IF EXISTS "title";--> statement-breakpoint
ALTER TABLE "gifts" DROP COLUMN IF EXISTS "media_id";--> statement-breakpoint
ALTER TABLE "gifts" DROP COLUMN IF EXISTS "is_unlocked";--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "journey_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "recipient_email" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "first_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "invite_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "unlock_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gifts" ALTER COLUMN "unlock_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
