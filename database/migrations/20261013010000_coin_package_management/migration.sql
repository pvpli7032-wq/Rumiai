ALTER TABLE "coin_packages" ADD COLUMN "bonus_starts_at" DATETIME;
ALTER TABLE "coin_packages" ADD COLUMN "bonus_ends_at" DATETIME;
ALTER TABLE "coin_packages" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "coin_package_changes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "package_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "before_json" TEXT,
  "after_json" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "coin_package_changes_package_id_created_at_idx" ON "coin_package_changes"("package_id", "created_at");
