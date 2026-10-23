ALTER TABLE "users" ADD COLUMN "deleted_at" DATETIME;
CREATE TABLE "account_closures" ("id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "file_urls_json" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING_FILES', "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "completed_at" DATETIME, FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "account_closures_user_id_key" ON "account_closures"("user_id");
CREATE TABLE "upload_assets" ("id" TEXT NOT NULL PRIMARY KEY, "owner_id" TEXT NOT NULL, "url" TEXT NOT NULL, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "upload_assets_url_key" ON "upload_assets"("url");
CREATE INDEX "upload_assets_owner_id_idx" ON "upload_assets"("owner_id");

CREATE TRIGGER "open_account_characters_insert" BEFORE INSERT ON "characters"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."creator_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_characters_update" BEFORE UPDATE OF name,tagline,personality,background,greeting,avatar_url,tags,scenario,role_template,is_public ON "characters"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."creator_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_conversations_insert" BEFORE INSERT ON "conversations"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_conversations_update" BEFORE UPDATE OF title,notes ON "conversations"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_posts_insert" BEFORE INSERT ON "posts"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."author_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_posts_update" BEFORE UPDATE OF content ON "posts"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."author_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_post_comments_insert" BEFORE INSERT ON "post_comments"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."author_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_post_comments_update" BEFORE UPDATE OF content,image_url ON "post_comments"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."author_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_comments_insert" BEFORE INSERT ON "comments"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."author_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_comments_update" BEFORE UPDATE OF body ON "comments"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."author_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_circles_insert" BEFORE INSERT ON "circles"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."owner_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_circles_update" BEFORE UPDATE OF name,description,tags ON "circles"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."owner_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_ai_calls_insert" BEFORE INSERT ON "ai_calls"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_ai_daily_usage_insert" BEFORE INSERT ON "ai_daily_usage"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_ai_daily_usage_update" BEFORE UPDATE OF count ON "ai_daily_usage"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_payment_orders_insert" BEFORE INSERT ON "payment_orders"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_upload_assets_insert" BEFORE INSERT ON "upload_assets"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."owner_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_upload_assets_update" BEFORE UPDATE OF url ON "upload_assets"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."owner_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_circle_members_insert" BEFORE INSERT ON "circle_members"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_character_bookmarks_insert" BEFORE INSERT ON "character_bookmarks"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_character_likes_insert" BEFORE INSERT ON "character_likes"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_comment_likes_insert" BEFORE INSERT ON "comment_likes"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_post_likes_insert" BEFORE INSERT ON "post_likes"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_gifts_insert" BEFORE INSERT ON "gifts"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."sender_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_checkins_insert" BEFORE INSERT ON "checkins"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_user_missions_insert" BEFORE INSERT ON "user_missions"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_user_missions_update" BEFORE UPDATE OF is_completed ON "user_missions"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_user_character_quests_insert" BEFORE INSERT ON "user_character_quests"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_follows_insert" BEFORE INSERT ON "follows"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."follower_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "closed_account_profile" BEFORE UPDATE OF email,username,display_name,avatar_url,password_hash,banned_words,shortcuts,last_checkin ON "users"
WHEN OLD."deleted_at" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_character_images_insert" BEFORE INSERT ON "character_images"
WHEN EXISTS (SELECT 1 FROM "characters" c JOIN "users" u ON u."id" = c."creator_id" WHERE c."id" = NEW."character_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_character_images_update" BEFORE UPDATE OF url ON "character_images"
WHEN EXISTS (SELECT 1 FROM "characters" c JOIN "users" u ON u."id" = c."creator_id" WHERE c."id" = NEW."character_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_character_emojis_insert" BEFORE INSERT ON "character_emojis"
WHEN EXISTS (SELECT 1 FROM "characters" c JOIN "users" u ON u."id" = c."creator_id" WHERE c."id" = NEW."character_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_character_emojis_update" BEFORE UPDATE OF url ON "character_emojis"
WHEN EXISTS (SELECT 1 FROM "characters" c JOIN "users" u ON u."id" = c."creator_id" WHERE c."id" = NEW."character_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_support_characters_insert" BEFORE INSERT ON "support_characters"
WHEN EXISTS (SELECT 1 FROM "characters" c JOIN "users" u ON u."id" = c."creator_id" WHERE c."id" = NEW."character_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_support_characters_update" BEFORE UPDATE OF name,description,avatar_url ON "support_characters"
WHEN EXISTS (SELECT 1 FROM "characters" c JOIN "users" u ON u."id" = c."creator_id" WHERE c."id" = NEW."character_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_character_quests_insert" BEFORE INSERT ON "character_quests"
WHEN EXISTS (SELECT 1 FROM "characters" c JOIN "users" u ON u."id" = c."creator_id" WHERE c."id" = NEW."character_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_character_quests_update" BEFORE UPDATE OF title,description ON "character_quests"
WHEN EXISTS (SELECT 1 FROM "characters" c JOIN "users" u ON u."id" = c."creator_id" WHERE c."id" = NEW."character_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_post_media_insert" BEFORE INSERT ON "post_media"
WHEN EXISTS (SELECT 1 FROM "posts" c JOIN "users" u ON u."id" = c."author_id" WHERE c."id" = NEW."post_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;

CREATE TRIGGER "open_account_post_media_update" BEFORE UPDATE OF url ON "post_media"
WHEN EXISTS (SELECT 1 FROM "posts" c JOIN "users" u ON u."id" = c."author_id" WHERE c."id" = NEW."post_id" AND u."deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;
