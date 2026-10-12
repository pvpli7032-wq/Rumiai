-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "coins" INTEGER NOT NULL DEFAULT 100,
    "streak_count" INTEGER NOT NULL DEFAULT 0,
    "last_checkin" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_users" ("avatar_url", "character_count", "chat_count", "coins", "created_at", "display_name", "email", "follower_count", "id", "last_checkin", "message_count", "password_hash", "streak_count", "tier", "universe_chat_count", "universe_message_count", "updated_at", "username", "weekly_follower_gain") SELECT "avatar_url", "character_count", "chat_count", "coins", "created_at", "display_name", "email", "follower_count", "id", "last_checkin", "message_count", "password_hash", "streak_count", "tier", "universe_chat_count", "universe_message_count", "updated_at", "username", "weekly_follower_gain" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

