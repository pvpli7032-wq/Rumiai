-- AlterTable
ALTER TABLE "users" ADD COLUMN "reader_preferences_json" TEXT;

-- AlterTable
ALTER TABLE "message_attachments" ADD COLUMN "duration_ms" INTEGER;
ALTER TABLE "message_attachments" ADD COLUMN "sticker_snapshot_json" TEXT;

-- AlterTable
ALTER TABLE "membership_orders" ADD COLUMN "plan_name_snapshot" TEXT;

-- AlterTable
ALTER TABLE "story_runs" ADD COLUMN "parent_run_id" TEXT;
ALTER TABLE "story_runs" ADD COLUMN "restored_from_save_id" TEXT;

-- AlterTable
ALTER TABLE "generation_charges" ADD COLUMN "message_version_id" TEXT;

-- CreateTable
CREATE TABLE "message_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_versions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_personas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_personas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "worldbooks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "worldbooks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "worldbook_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worldbook_id" TEXT NOT NULL,
    "keywords_json" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "worldbook_entries_worldbook_id_fkey" FOREIGN KEY ("worldbook_id") REFERENCES "worldbooks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conversation_worldbooks" (
    "conversation_id" TEXT NOT NULL,
    "worldbook_id" TEXT NOT NULL,

    PRIMARY KEY ("conversation_id", "worldbook_id"),
    CONSTRAINT "conversation_worldbooks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversation_worldbooks_worldbook_id_fkey" FOREIGN KEY ("worldbook_id") REFERENCES "worldbooks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "character_worldbooks" (
    "character_id" TEXT NOT NULL,
    "worldbook_id" TEXT NOT NULL,

    PRIMARY KEY ("character_id", "worldbook_id"),
    CONSTRAINT "character_worldbooks_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "character_worldbooks_worldbook_id_fkey" FOREIGN KEY ("worldbook_id") REFERENCES "worldbooks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conversation_context_uses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "sources_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_context_uses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "message_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_search_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "last_used_at" DATETIME NOT NULL,
    CONSTRAINT "user_search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_hidden_characters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_hidden_characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_hidden_characters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "character_drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "draft_json" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "character_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "story_saves" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snapshot_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_saves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_saves_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "story_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "categories_json" TEXT NOT NULL DEFAULT '{}',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "quiet_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_start_minute" INTEGER NOT NULL DEFAULT 1320,
    "quiet_end_minute" INTEGER NOT NULL DEFAULT 480,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "proactive_subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "window_start_minute" INTEGER NOT NULL DEFAULT 540,
    "window_end_minute" INTEGER NOT NULL DEFAULT 1260,
    "interval_hours" INTEGER NOT NULL DEFAULT 24,
    "next_run_at" DATETIME NOT NULL,
    "last_attempt_at" DATETIME,
    "last_sent_at" DATETIME,
    "last_message_id" TEXT,
    "last_error" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "proactive_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proactive_subscriptions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_stickers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "glyph" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "media_task_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "asset_id" TEXT,
    "result_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "error_code" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    CONSTRAINT "media_task_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "media_task_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_conversations" (
    "pinned_at" DATETIME,
    "parent_conversation_id" TEXT,
    "fork_message_id" TEXT,
    "persona_id" TEXT,
    "personal_character_override" TEXT,
    "response_style" TEXT,
    "response_length" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "title" TEXT,
    "relationship_status" TEXT,
    "romance" INTEGER NOT NULL DEFAULT 0,
    "intimacy" INTEGER NOT NULL DEFAULT 0,
    "relationship_mode" BOOLEAN NOT NULL DEFAULT true,
    "ai_model" TEXT,
    "notes" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "conversations_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "user_personas" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_conversations" ("ai_model", "archived_at", "character_id", "created_at", "id", "intimacy", "notes", "relationship_mode", "relationship_status", "romance", "title", "updated_at", "user_id") SELECT "ai_model", "archived_at", "character_id", "created_at", "id", "intimacy", "notes", "relationship_mode", "relationship_status", "romance", "title", "updated_at", "user_id" FROM "conversations";
DROP TABLE "conversations";
ALTER TABLE "new_conversations" RENAME TO "conversations";
CREATE INDEX "conversations_user_id_idx" ON "conversations"("user_id");
CREATE INDEX "conversations_character_id_idx" ON "conversations"("character_id");
CREATE INDEX "conversations_user_id_character_id_idx" ON "conversations"("user_id", "character_id");
CREATE INDEX "conversations_user_id_archived_at_idx" ON "conversations"("user_id", "archived_at");
CREATE TABLE "new_messages" (
    "context_included" BOOLEAN NOT NULL DEFAULT true,
    "selected_version_id" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "liked_at" DATETIME,
    "image_url" TEXT,
    "media_request_id" TEXT,
    "media_request_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_messages" ("content", "conversation_id", "created_at", "id", "image_url", "liked_at", "media_request_hash", "media_request_id", "role") SELECT "content", "conversation_id", "created_at", "id", "image_url", "liked_at", "media_request_hash", "media_request_id", "role" FROM "messages";
DROP TABLE "messages";
ALTER TABLE "new_messages" RENAME TO "messages";
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");
CREATE UNIQUE INDEX "messages_conversation_id_media_request_id_key" ON "messages"("conversation_id", "media_request_id");
CREATE TABLE "new_ai_models" (
    "supports_chat" BOOLEAN NOT NULL DEFAULT true,
    "supports_vision" BOOLEAN NOT NULL DEFAULT false,
    "supports_transcription" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "model_code" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "default_slot" TEXT,
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "timeout_ms" INTEGER NOT NULL DEFAULT 60000,
    "max_retries" INTEGER NOT NULL DEFAULT 1,
    "max_output_tokens" INTEGER NOT NULL DEFAULT 800,
    "last_check_at" DATETIME,
    "last_check_status" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "ai_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ai_models" ("created_at", "default_slot", "display_name", "id", "is_active", "is_default", "is_fallback", "key", "last_check_at", "last_check_status", "max_output_tokens", "max_retries", "model_code", "provider_id", "sort_order", "timeout_ms", "updated_at", "version") SELECT "created_at", "default_slot", "display_name", "id", "is_active", "is_default", "is_fallback", "key", "last_check_at", "last_check_status", "max_output_tokens", "max_retries", "model_code", "provider_id", "sort_order", "timeout_ms", "updated_at", "version" FROM "ai_models";
DROP TABLE "ai_models";
ALTER TABLE "new_ai_models" RENAME TO "ai_models";
CREATE UNIQUE INDEX "ai_models_key_key" ON "ai_models"("key");
CREATE UNIQUE INDEX "ai_models_default_slot_key" ON "ai_models"("default_slot");
CREATE INDEX "ai_models_is_active_is_default_is_fallback_sort_order_id_idx" ON "ai_models"("is_active", "is_default", "is_fallback", "sort_order", "id");
CREATE UNIQUE INDEX "ai_models_provider_id_model_code_key" ON "ai_models"("provider_id", "model_code");
CREATE TABLE "new_notifications" (
    "delivery_state" TEXT NOT NULL DEFAULT 'DELIVERED',
    "available_at" DATETIME,
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
INSERT INTO "new_notifications" ("body", "created_at", "id", "read_at", "target_id", "target_type", "title", "type", "user_id") SELECT "body", "created_at", "id", "read_at", "target_id", "target_type", "title", "type", "user_id" FROM "notifications";
DROP TABLE "notifications";
ALTER TABLE "new_notifications" RENAME TO "notifications";
CREATE INDEX "notifications_user_id_delivery_state_available_at_idx" ON "notifications"("user_id", "delivery_state", "available_at");
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "message_versions_message_id_created_at_idx" ON "message_versions"("message_id", "created_at");

-- CreateIndex
CREATE INDEX "user_personas_user_id_idx" ON "user_personas"("user_id");

-- CreateIndex
CREATE INDEX "worldbooks_user_id_idx" ON "worldbooks"("user_id");

-- CreateIndex
CREATE INDEX "worldbook_entries_worldbook_id_priority_idx" ON "worldbook_entries"("worldbook_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_context_uses_conversation_id_request_id_key" ON "conversation_context_uses"("conversation_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_feedback_user_id_message_id_reason_key" ON "message_feedback"("user_id", "message_id", "reason");

-- CreateIndex
CREATE INDEX "user_search_history_user_id_last_used_at_idx" ON "user_search_history"("user_id", "last_used_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_search_history_user_id_query_key" ON "user_search_history"("user_id", "query");

-- CreateIndex
CREATE UNIQUE INDEX "user_hidden_characters_user_id_character_id_key" ON "user_hidden_characters"("user_id", "character_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_drafts_user_id_slot_key" ON "character_drafts"("user_id", "slot");

-- CreateIndex
CREATE INDEX "story_saves_user_id_run_id_created_at_idx" ON "story_saves"("user_id", "run_id", "created_at");

-- CreateIndex
CREATE INDEX "proactive_subscriptions_enabled_next_run_at_idx" ON "proactive_subscriptions"("enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "proactive_subscriptions_user_id_conversation_id_key" ON "proactive_subscriptions"("user_id", "conversation_id");

-- CreateIndex
CREATE INDEX "chat_stickers_is_active_sort_order_id_idx" ON "chat_stickers"("is_active", "sort_order", "id");

-- CreateIndex
CREATE INDEX "media_task_requests_user_id_operation_created_at_idx" ON "media_task_requests"("user_id", "operation", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_task_requests_user_id_operation_request_id_key" ON "media_task_requests"("user_id", "operation", "request_id");


UPDATE membership_orders SET plan_name_snapshot = (SELECT name FROM membership_plans WHERE membership_plans.id = membership_orders.plan_id) WHERE plan_name_snapshot IS NULL;

-- Preserve the existing six stickers as editable catalogue entries.
INSERT INTO chat_stickers (id,label,glyph,is_active,sort_order,version,created_at,updated_at) VALUES ('wave','挥手','👋',1,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
UPDATE message_attachments SET sticker_snapshot_json='{"label":"挥手","glyph":"👋"}' WHERE type='STICKER' AND sticker_id='wave';
INSERT INTO chat_stickers (id,label,glyph,is_active,sort_order,version,created_at,updated_at) VALUES ('heart','喜欢','🥰',1,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
UPDATE message_attachments SET sticker_snapshot_json='{"label":"喜欢","glyph":"🥰"}' WHERE type='STICKER' AND sticker_id='heart';
INSERT INTO chat_stickers (id,label,glyph,is_active,sort_order,version,created_at,updated_at) VALUES ('laugh','大笑','🤣',1,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
UPDATE message_attachments SET sticker_snapshot_json='{"label":"大笑","glyph":"🤣"}' WHERE type='STICKER' AND sticker_id='laugh';
INSERT INTO chat_stickers (id,label,glyph,is_active,sort_order,version,created_at,updated_at) VALUES ('cheer','庆祝','🎉',1,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
UPDATE message_attachments SET sticker_snapshot_json='{"label":"庆祝","glyph":"🎉"}' WHERE type='STICKER' AND sticker_id='cheer';
INSERT INTO chat_stickers (id,label,glyph,is_active,sort_order,version,created_at,updated_at) VALUES ('hug','抱抱','🤗',1,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
UPDATE message_attachments SET sticker_snapshot_json='{"label":"抱抱","glyph":"🤗"}' WHERE type='STICKER' AND sticker_id='hug';
INSERT INTO chat_stickers (id,label,glyph,is_active,sort_order,version,created_at,updated_at) VALUES ('sad','难过','🥺',1,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
UPDATE message_attachments SET sticker_snapshot_json='{"label":"难过","glyph":"🥺"}' WHERE type='STICKER' AND sticker_id='sad';
