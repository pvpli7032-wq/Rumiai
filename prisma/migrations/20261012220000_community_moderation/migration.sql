ALTER TABLE "users" ADD COLUMN "community_banned_at" DATETIME;
ALTER TABLE "users" ADD COLUMN "community_ban_reason" TEXT;

CREATE TABLE "community_appeals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolution" TEXT,
  "reviewed_by" TEXT,
  "reviewed_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "community_appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "community_appeals_status_created_at_idx" ON "community_appeals"("status", "created_at");
CREATE INDEX "community_appeals_user_id_created_at_idx" ON "community_appeals"("user_id", "created_at");
