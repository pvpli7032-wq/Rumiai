-- CreateTable
CREATE TABLE "circles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT,
    "owner_id" TEXT NOT NULL,
    "universe_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "circles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "circles_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "circle_members" (
    "circle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("circle_id", "user_id"),
    CONSTRAINT "circle_members_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "circle_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "circle_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "character_id" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VISIBLE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "posts_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "posts_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_likes" (
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("post_id", "user_id"),
    CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "image_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VISIBLE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "follows" (
    "follower_id" TEXT NOT NULL,
    "following_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("follower_id", "following_id"),
    CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "moderation_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "publication_requested" BOOLEAN NOT NULL DEFAULT false,
    "review_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "review_reason" TEXT,
    "copyright_statement" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" DATETIME,
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
INSERT INTO "new_characters" ("avatar_url", "background", "badges", "chat_count", "copyright_statement", "created_at", "creator_id", "gift_count", "greeting", "id", "initial_intimacy", "initial_romance", "is_adult", "is_exclusive", "is_public", "like_count", "message_count", "name", "personality", "publication_requested", "relationship_status", "review_reason", "review_status", "reviewed_at", "reviewed_by", "role_template", "scenario", "tagline", "tags", "updated_at") SELECT "avatar_url", "background", "badges", "chat_count", "copyright_statement", "created_at", "creator_id", "gift_count", "greeting", "id", "initial_intimacy", "initial_romance", "is_adult", "is_exclusive", "is_public", "like_count", "message_count", "name", "personality", "publication_requested", "relationship_status", "review_reason", "review_status", "reviewed_at", "reviewed_by", "role_template", "scenario", "tagline", "tags", "updated_at" FROM "characters";
DROP TABLE "characters";
ALTER TABLE "new_characters" RENAME TO "characters";
CREATE INDEX "characters_creator_id_idx" ON "characters"("creator_id");
CREATE INDEX "characters_is_public_idx" ON "characters"("is_public");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "circles_status_created_at_idx" ON "circles"("status", "created_at");

-- CreateIndex
CREATE INDEX "circle_members_user_id_created_at_idx" ON "circle_members"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "posts_circle_id_status_created_at_idx" ON "posts"("circle_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "posts_author_id_created_at_idx" ON "posts"("author_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "post_media_post_id_position_key" ON "post_media"("post_id", "position");

-- CreateIndex
CREATE INDEX "post_comments_post_id_status_created_at_idx" ON "post_comments"("post_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "follows_following_id_created_at_idx" ON "follows"("following_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_target_type_target_id_created_at_idx" ON "moderation_actions"("target_type", "target_id", "created_at");
