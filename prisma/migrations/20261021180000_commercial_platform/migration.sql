-- 商业改造平台底座（V3 实施版，2026-10-21 批复）。
-- 纯增量：新建 12 张表 + coin_transactions 两列 + ai_calls 重建为可空会话/用户。
-- 不 ALTER 任何既有业务表的既有列语义；不 DROP 任何业务表。
-- 回滚：新表无数据时可直接 DROP；ai_calls 回滚需反向重建（保留原列）。

-- ---------- 设置中心 ----------
CREATE TABLE "operation_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "group" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
CREATE INDEX "operation_settings_group_idx" ON "operation_settings"("group");

CREATE TABLE "user_setting_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_setting_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_setting_overrides_user_id_key_key" ON "user_setting_overrides"("user_id", "key");
CREATE INDEX "user_setting_overrides_expires_at_idx" ON "user_setting_overrides"("expires_at");

CREATE TABLE "setting_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "user_id" TEXT,
    "old_value" TEXT,
    "new_value" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "setting_revisions_key_created_at_idx" ON "setting_revisions"("key", "created_at");
CREATE INDEX "setting_revisions_scope_created_at_idx" ON "setting_revisions"("scope", "created_at");

-- ---------- 计费 ----------
CREATE TABLE "model_coin_prices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "model_id" TEXT NOT NULL,
    "coins_per_reply" INTEGER NOT NULL,
    "effective_at" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "model_coin_prices_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "model_coin_prices_model_id_effective_at_key" ON "model_coin_prices"("model_id", "effective_at");

CREATE TABLE "generation_charges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "coins" INTEGER NOT NULL DEFAULT 0,
    "price_snapshot_json" TEXT NOT NULL,
    "allowance_source" TEXT,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "ai_call_id" TEXT,
    "held_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" DATETIME,
    "released_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "generation_charges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "generation_charges_user_id_operation_request_id_key" ON "generation_charges"("user_id", "operation", "request_id");
CREATE INDEX "generation_charges_status_held_at_idx" ON "generation_charges"("status", "held_at");

CREATE TABLE "user_daily_allowances" (
    "user_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "free_used" INTEGER NOT NULL DEFAULT 0,
    "free_reserved" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("user_id", "day"),
    CONSTRAINT "user_daily_allowances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ---------- 新玩法 ----------
CREATE TABLE "mirror_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "share_id" TEXT NOT NULL,
    "user_id" TEXT,
    "anonymous_subject" TEXT,
    "character_id" TEXT NOT NULL,
    "answers_json" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "observations_json" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "indices_json" TEXT NOT NULL,
    "raw_json" TEXT,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "charge_id" TEXT,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mirror_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mirror_results_share_id_key" ON "mirror_results"("share_id");
CREATE INDEX "mirror_results_status_created_at_idx" ON "mirror_results"("status", "created_at");
CREATE INDEX "mirror_results_user_id_created_at_idx" ON "mirror_results"("user_id", "created_at");

CREATE TABLE "dispute_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "character_id" TEXT,
    "excerpt_json" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "rule_snapshot_json" TEXT NOT NULL,
    "deadline_at" DATETIME NOT NULL,
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "close_status" TEXT NOT NULL DEFAULT 'OPEN',
    "verdict_json" TEXT,
    "closed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "dispute_cases_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "dispute_cases_post_id_key" ON "dispute_cases"("post_id");
CREATE INDEX "dispute_cases_close_status_deadline_at_idx" ON "dispute_cases"("close_status", "deadline_at");
CREATE INDEX "dispute_cases_author_id_created_at_idx" ON "dispute_cases"("author_id", "created_at");

CREATE TABLE "dispute_votes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "case_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "revise_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "dispute_votes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "dispute_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "dispute_votes_case_id_user_id_key" ON "dispute_votes"("case_id", "user_id");
CREATE INDEX "dispute_votes_user_id_created_at_idx" ON "dispute_votes"("user_id", "created_at");

-- ---------- 记忆与任务 ----------
CREATE TABLE "conversation_memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "covered_message_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "conversation_memories_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "conversation_memories_conversation_id_key" ON "conversation_memories"("conversation_id");

CREATE TABLE "memory_facts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source_message_id" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "memory_facts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "memory_facts_conversation_id_status_idx" ON "memory_facts"("conversation_id", "status");
CREATE INDEX "memory_facts_user_id_created_at_idx" ON "memory_facts"("user_id", "created_at");

CREATE TABLE "background_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_until" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "background_tasks_kind_subject_id_key" ON "background_tasks"("kind", "subject_id");
CREATE INDEX "background_tasks_status_next_run_at_idx" ON "background_tasks"("status", "next_run_at");

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "target_type" TEXT,
    "target_id" TEXT,
    "read_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

CREATE TABLE "product_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "subject_key" TEXT,
    "user_id" TEXT,
    "anonymous_subject" TEXT,
    "properties_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "product_events_name_created_at_idx" ON "product_events"("name", "created_at");

-- ---------- 既有表扩列：金币流水关联费用单（既有行为 NULL，不进唯一约束） ----------
ALTER TABLE "coin_transactions" ADD COLUMN "charge_id" TEXT;
ALTER TABLE "coin_transactions" ADD COLUMN "charge_action" TEXT;
CREATE UNIQUE INDEX "coin_transactions_charge_id_charge_action_key" ON "coin_transactions"("charge_id", "charge_action");

-- ---------- 既有表重建：ai_calls 支持匿名与后台任务调用 ----------
-- 原表 user_id / conversation_id 为 NOT NULL，匿名 Mirror 与后台摘要无法复用。
-- 逐行复制并保留既有索引与 model_price_id 外键。
CREATE TABLE "new_ai_calls" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "conversation_id" TEXT,
    "task_type" TEXT,
    "anonymous_subject" TEXT,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "model" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "estimated_cost" REAL,
    "model_price_id" TEXT,
    "currency" TEXT NOT NULL,
    "error_code" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "duration_ms" INTEGER,
    CONSTRAINT "ai_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_calls_model_price_id_fkey" FOREIGN KEY ("model_price_id") REFERENCES "ai_model_prices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ai_calls" ("id","user_id","conversation_id","operation","status","model","attempts","input_tokens","output_tokens","estimated_cost","model_price_id","currency","error_code","started_at","finished_at","duration_ms")
SELECT "id","user_id","conversation_id","operation","status","model","attempts","input_tokens","output_tokens","estimated_cost","model_price_id","currency","error_code","started_at","finished_at","duration_ms" FROM "ai_calls";
DROP TABLE "ai_calls";
ALTER TABLE "new_ai_calls" RENAME TO "ai_calls";
CREATE INDEX "ai_calls_user_id_started_at_idx" ON "ai_calls"("user_id", "started_at");
CREATE INDEX "ai_calls_currency_started_at_idx" ON "ai_calls"("currency", "started_at");
CREATE INDEX "ai_calls_model_price_id_idx" ON "ai_calls"("model_price_id");
CREATE INDEX "ai_calls_task_type_started_at_idx" ON "ai_calls"("task_type", "started_at");
