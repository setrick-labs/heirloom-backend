CREATE TYPE "public"."media_processing_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "processing_status" "media_processing_status";