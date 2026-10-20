-- 纯增量：只 CREATE 新表/索引，零 ALTER 零 DROP（W07 分享关联，2026-10-20 批复）。
-- 回滚：无数据时可直接 DROP TABLE "story_shares"；已有分享记录后删除需数据负责人批准。
CREATE TABLE "story_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "selected_message_ids_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "published_post_id" TEXT,
    "withdrawn_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "story_shares_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "story_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "story_shares_run_id_idx" ON "story_shares"("run_id");
CREATE INDEX "story_shares_user_id_created_at_idx" ON "story_shares"("user_id", "created_at");
