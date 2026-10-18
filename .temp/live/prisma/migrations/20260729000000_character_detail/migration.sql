-- CreateTable
CREATE TABLE "character_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "character_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_images_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "character_emojis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "character_id" TEXT NOT NULL,
    "emotion" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "character_emojis_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "support_characters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "character_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "description" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "support_characters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "character_likes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "character_likes_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "character_bookmarks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "character_bookmarks_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_characters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "personality" TEXT NOT NULL,
    "background" TEXT NOT NULL,
    "greeting" TEXT,
    "avatar_url" TEXT,
    "creator_id" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "chat_count" INTEGER NOT NULL DEFAULT 0,
    "is_exclusive" BOOLEAN NOT NULL DEFAULT false,
    "badges" TEXT,
    "tags" TEXT,
    "role_template" TEXT,
    "scenario" TEXT,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "gift_count" INTEGER NOT NULL DEFAULT 0,
    "is_adult" BOOLEAN NOT NULL DEFAULT false,
    "relationship_status" TEXT,
    "initial_romance" INTEGER NOT NULL DEFAULT 0,
    "initial_intimacy" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "characters_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_characters" ("avatar_url", "background", "badges", "chat_count", "created_at", "creator_id", "greeting", "id", "is_exclusive", "is_public", "name", "personality", "tagline", "tags", "updated_at") SELECT "avatar_url", "background", "badges", "chat_count", "created_at", "creator_id", "greeting", "id", "is_exclusive", "is_public", "name", "personality", "tagline", "tags", "updated_at" FROM "characters";
DROP TABLE "characters";
ALTER TABLE "new_characters" RENAME TO "characters";
CREATE INDEX "characters_creator_id_idx" ON "characters"("creator_id");
CREATE INDEX "characters_is_public_idx" ON "characters"("is_public");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "character_images_character_id_sort_order_idx" ON "character_images"("character_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "character_emojis_character_id_emotion_key" ON "character_emojis"("character_id", "emotion");

-- CreateIndex
CREATE INDEX "support_characters_character_id_sort_order_idx" ON "support_characters"("character_id", "sort_order");

-- CreateIndex
CREATE INDEX "character_likes_character_id_idx" ON "character_likes"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_likes_user_id_character_id_key" ON "character_likes"("user_id", "character_id");

-- CreateIndex
CREATE INDEX "character_bookmarks_user_id_idx" ON "character_bookmarks"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_bookmarks_user_id_character_id_key" ON "character_bookmarks"("user_id", "character_id");

