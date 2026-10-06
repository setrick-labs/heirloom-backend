ALTER TABLE "vault_items" ADD COLUMN "thumbnail_storage_key" text;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "display_storage_key" text;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "zoom_storage_key" text;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "poster_storage_key" text;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "blurhash" text;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "processing_status" "media_processing_status";--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "thumbnail_storage_key" text;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "display_storage_key" text;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "zoom_storage_key" text;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "poster_storage_key" text;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "blurhash" text;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "processing_status" "media_processing_status";--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "shared_vault_items" ADD COLUMN "duration_seconds" integer;