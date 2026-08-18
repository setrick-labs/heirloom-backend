CREATE INDEX "family_members_user_id_idx" ON "family_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_id_type_idx" ON "auth_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "auth_tokens_token_hash_idx" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "vault_items_owner_id_idx" ON "vault_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "gifts_journey_id_idx" ON "gifts" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "gifts_to_user_id_idx" ON "gifts" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "gifts_from_user_id_idx" ON "gifts" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "gifts_recipient_email_idx" ON "gifts" USING btree ("recipient_email");