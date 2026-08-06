-- Private Vault spec: vault_items must be person-scoped, not family-scoped
-- (Section 4), and must never route through the shared `media` table
-- (Section 5). Table has zero rows in every environment so far — safe to
-- drop and recreate the affected columns rather than migrate data.
ALTER TABLE "vault_items" DROP CONSTRAINT IF EXISTS "vault_items_family_id_families_id_fk";--> statement-breakpoint
ALTER TABLE "vault_items" DROP CONSTRAINT IF EXISTS "vault_items_media_id_media_id_fk";--> statement-breakpoint
ALTER TABLE "vault_items" DROP COLUMN IF EXISTS "family_id";--> statement-breakpoint
ALTER TABLE "vault_items" DROP COLUMN IF EXISTS "media_id";--> statement-breakpoint
ALTER TABLE "vault_items" DROP COLUMN IF EXISTS "title";--> statement-breakpoint
ALTER TABLE "vault_items" DROP COLUMN IF EXISTS "note";--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "type" "media_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "storage_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "caption" varchar(500);--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint

-- Private Vault spec Section 1: the vault's own, independent password.
ALTER TABLE "users" ADD COLUMN "vault_password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vault_sessions_invalidated_at" timestamp with time zone;
