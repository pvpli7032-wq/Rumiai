-- CreateTable
CREATE TABLE "character_quests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "character_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reward_coins" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_quests_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_character_quests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "quest_id" TEXT NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" DATETIME,
    CONSTRAINT "user_character_quests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_character_quests_quest_id_fkey" FOREIGN KEY ("quest_id") REFERENCES "character_quests" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporter_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "image_reason" TEXT,
    "details" TEXT NOT NULL,
    "work_title" TEXT,
    "relationship" TEXT,
    "source_link" TEXT,
    "contact_type" TEXT,
    "contact_value" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_character_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "character_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'IMAGE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_images_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_character_images" ("character_id", "created_at", "id", "sort_order", "url") SELECT "character_id", "created_at", "id", "sort_order", "url" FROM "character_images";
DROP TABLE "character_images";
ALTER TABLE "new_character_images" RENAME TO "character_images";
CREATE INDEX "character_images_character_id_sort_order_idx" ON "character_images"("character_id", "sort_order");
CREATE TABLE "new_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "title" TEXT,
    "relationship_status" TEXT,
    "romance" INTEGER NOT NULL DEFAULT 0,
    "intimacy" INTEGER NOT NULL DEFAULT 0,
    "relationship_mode" BOOLEAN NOT NULL DEFAULT true,
    "ai_model" TEXT,
    "notes" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_conversations" ("archived_at", "character_id", "created_at", "id", "intimacy", "notes", "relationship_status", "romance", "title", "updated_at", "user_id") SELECT "archived_at", "character_id", "created_at", "id", "intimacy", "notes", "relationship_status", "romance", "title", "updated_at", "user_id" FROM "conversations";
DROP TABLE "conversations";
ALTER TABLE "new_conversations" RENAME TO "conversations";
CREATE INDEX "conversations_user_id_idx" ON "conversations"("user_id");
CREATE INDEX "conversations_character_id_idx" ON "conversations"("character_id");
CREATE INDEX "conversations_user_id_character_id_idx" ON "conversations"("user_id", "character_id");
CREATE INDEX "conversations_user_id_archived_at_idx" ON "conversations"("user_id", "archived_at");
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "avatar_url" TEXT,
    "display_name" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'ROOKIE',
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "character_count" INTEGER NOT NULL DEFAULT 0,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "chat_count" INTEGER NOT NULL DEFAULT 0,
    "universe_message_count" INTEGER NOT NULL DEFAULT 0,
    "universe_chat_count" INTEGER NOT NULL DEFAULT 0,
    "weekly_follower_gain" INTEGER NOT NULL DEFAULT 0,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "banned_words" TEXT,
    "reading_mode" BOOLEAN NOT NULL DEFAULT false,
    "shortcuts" TEXT,
    "coins" INTEGER NOT NULL DEFAULT 100,
    "streak_count" INTEGER NOT NULL DEFAULT 0,
    "last_checkin" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_users" ("avatar_url", "character_count", "chat_count", "coins", "created_at", "display_name", "email", "follower_count", "id", "last_checkin", "message_count", "password_hash", "streak_count", "tier", "token_version", "universe_chat_count", "universe_message_count", "updated_at", "username", "weekly_follower_gain") SELECT "avatar_url", "character_count", "chat_count", "coins", "created_at", "display_name", "email", "follower_count", "id", "last_checkin", "message_count", "password_hash", "streak_count", "tier", "token_version", "universe_chat_count", "universe_message_count", "updated_at", "username", "weekly_follower_gain" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "character_quests_character_id_sort_order_idx" ON "character_quests"("character_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "user_character_quests_user_id_quest_id_key" ON "user_character_quests"("user_id", "quest_id");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "reports_reporter_id_idx" ON "reports"("reporter_id");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

