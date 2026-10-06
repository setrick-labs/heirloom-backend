ALTER TYPE "public"."auth_token_type" ADD VALUE 'vault_recovery';--> statement-breakpoint
ALTER TYPE "public"."auth_token_type" ADD VALUE 'shared_vault_recovery';--> statement-breakpoint
ALTER TYPE "public"."auth_token_type" ADD VALUE 'email_change';--> statement-breakpoint
CREATE TABLE "family_email_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"invited_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "scope_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "email" varchar(255);--> statement-breakpoint
ALTER TABLE "family_email_invites" ADD CONSTRAINT "family_email_invites_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_email_invites" ADD CONSTRAINT "family_email_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_email_invites" ADD CONSTRAINT "family_email_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "family_email_invites_token_hash_idx" ON "family_email_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "family_email_invites_pending_idx" ON "family_email_invites" USING btree ("family_id","email") WHERE "family_email_invites"."accepted_at" IS NULL AND "family_email_invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "family_email_invites_email_idx" ON "family_email_invites" USING btree ("email");