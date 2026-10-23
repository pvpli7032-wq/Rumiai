-- AlterTable
ALTER TABLE "messages" ADD COLUMN "image_url" TEXT;
ALTER TABLE "messages" ADD COLUMN "liked_at" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "title" TEXT,
    "relationship_status" TEXT,
    "romance" INTEGER NOT NULL DEFAULT 0,
    "intimacy" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_conversations" ("character_id", "created_at", "id", "title", "updated_at", "user_id") SELECT "character_id", "created_at", "id", "title", "updated_at", "user_id" FROM "conversations";
DROP TABLE "conversations";
ALTER TABLE "new_conversations" RENAME TO "conversations";
CREATE INDEX "conversations_user_id_idx" ON "conversations"("user_id");
CREATE INDEX "conversations_character_id_idx" ON "conversations"("character_id");
CREATE INDEX "conversations_user_id_character_id_idx" ON "conversations"("user_id", "character_id");
CREATE INDEX "conversations_user_id_archived_at_idx" ON "conversations"("user_id", "archived_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

