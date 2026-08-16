CREATE TYPE "public"."view_target_type" AS ENUM('journey', 'milestone');--> statement-breakpoint
CREATE TABLE "content_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "view_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_views_user_target_unique" UNIQUE("user_id","target_type","target_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vault_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vault_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "cover_storage_key" text;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "nickname" varchar(120);--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "cover_storage_key" text;--> statement-breakpoint
ALTER TABLE "content_views" ADD CONSTRAINT "content_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_views_user_target_type_idx" ON "content_views" USING btree ("user_id","target_type");