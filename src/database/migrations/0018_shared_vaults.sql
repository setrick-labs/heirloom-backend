CREATE TYPE "public"."shared_vault_deletion_status" AS ENUM('pending', 'approved', 'declined', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."shared_vault_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."shared_vault_member_status" AS ENUM('invited', 'active');--> statement-breakpoint
CREATE TABLE "shared_vault_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"item_id" uuid,
	"requested_by" uuid NOT NULL,
	"status" "shared_vault_deletion_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_vault_deletion_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"approve" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_vault_deletion_votes_request_user_unique" UNIQUE("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "shared_vault_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"uploader_id" uuid,
	"type" "media_type" NOT NULL,
	"storage_key" text NOT NULL,
	"caption" varchar(500),
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_vault_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "shared_vault_member_role" DEFAULT 'member' NOT NULL,
	"status" "shared_vault_member_status" DEFAULT 'invited' NOT NULL,
	"invited_by" uuid,
	"passcode_hash" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"sessions_invalidated_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_vault_members_vault_user_unique" UNIQUE("vault_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "shared_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_vault_deletion_requests" ADD CONSTRAINT "shared_vault_deletion_requests_vault_id_shared_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."shared_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_deletion_requests" ADD CONSTRAINT "shared_vault_deletion_requests_item_id_shared_vault_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shared_vault_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_deletion_requests" ADD CONSTRAINT "shared_vault_deletion_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_deletion_votes" ADD CONSTRAINT "shared_vault_deletion_votes_request_id_shared_vault_deletion_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."shared_vault_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_deletion_votes" ADD CONSTRAINT "shared_vault_deletion_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD CONSTRAINT "shared_vault_items_vault_id_shared_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."shared_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD CONSTRAINT "shared_vault_items_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_members" ADD CONSTRAINT "shared_vault_members_vault_id_shared_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."shared_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_members" ADD CONSTRAINT "shared_vault_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vault_members" ADD CONSTRAINT "shared_vault_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vaults" ADD CONSTRAINT "shared_vaults_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_vaults" ADD CONSTRAINT "shared_vaults_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_vault_deletion_requests_vault_id_idx" ON "shared_vault_deletion_requests" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "shared_vault_items_vault_id_idx" ON "shared_vault_items" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "shared_vault_items_uploader_id_idx" ON "shared_vault_items" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "shared_vault_members_user_id_idx" ON "shared_vault_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shared_vaults_family_id_idx" ON "shared_vaults" USING btree ("family_id");