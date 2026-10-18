CREATE TABLE "user_activity_days" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "activity_date" DATETIME NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_activity_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_activity_days_user_id_activity_date_key" ON "user_activity_days"("user_id", "activity_date");
CREATE INDEX "user_activity_days_activity_date_user_id_idx" ON "user_activity_days"("activity_date", "user_id");