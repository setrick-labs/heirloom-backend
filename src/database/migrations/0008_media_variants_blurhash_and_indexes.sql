ALTER TABLE "media" ADD COLUMN "thumbnail_storage_key" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "display_storage_key" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "blurhash" text;--> statement-breakpoint
CREATE INDEX "journeys_family_id_idx" ON "journeys" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "milestones_journey_id_idx" ON "milestones" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "media_family_id_idx" ON "media" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "media_milestone_id_idx" ON "media" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "comments_target_type_target_id_idx" ON "comments" USING btree ("target_type","target_id");