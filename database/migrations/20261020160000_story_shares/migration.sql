-- 纯增量：只 CREATE 新表/索引，零 ALTER 零 DROP（W07 分享关联，2026-10-20 批复）。
-- 回滚：无数据时可直接 DROP TABLE "story_share_turns"、"story_shares"；已有分享记录后删除需数据负责人批准。
CREATE TABLE "story_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "selected_message_ids_json" TEXT NOT NULL,
    "snapshot_json" TEXT NOT NULL,
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

-- 分享快照与消息的固定对应：创建时写入，消息删除时置空（ON DELETE SET NULL），快照正文不变。
CREATE TABLE "story_share_turns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "share_id" TEXT NOT NULL,
    "message_id" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_share_turns_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "story_shares" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_share_turns_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_share_turns_share_id_position_key" ON "story_share_turns"("share_id", "position");
CREATE INDEX "story_share_turns_message_id_idx" ON "story_share_turns"("message_id");
