CREATE TABLE "story_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "owner_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "story_templates_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_templates_slug_key" ON "story_templates"("slug");
CREATE INDEX "story_templates_status_updated_at_id_idx" ON "story_templates"("status", "updated_at", "id");

CREATE TABLE "story_template_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "definition_json" TEXT NOT NULL,
    "character_snapshot_json" TEXT NOT NULL,
    "published_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "story_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_template_versions_template_id_version_locale_key" ON "story_template_versions"("template_id", "version", "locale");
CREATE INDEX "story_template_versions_locale_published_at_idx" ON "story_template_versions"("locale", "published_at");

CREATE TABLE "story_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "template_version_id" TEXT NOT NULL,
    "chapter_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "last_committed_turn_no" INTEGER NOT NULL DEFAULT 0,
    "state_processed_through_turn_no" INTEGER NOT NULL DEFAULT 0,
    "state_json" TEXT NOT NULL,
    "create_request_id" TEXT NOT NULL,
    "active_turn_id" TEXT,
    "started_at" DATETIME NOT NULL,
    "ended_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "story_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_runs_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "story_template_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_runs_conversation_id_key" ON "story_runs"("conversation_id");
CREATE UNIQUE INDEX "story_runs_user_id_create_request_id_key" ON "story_runs"("user_id", "create_request_id");
CREATE UNIQUE INDEX "story_runs_active_turn_id_key" ON "story_runs"("active_turn_id");
CREATE INDEX "story_runs_user_id_updated_at_id_idx" ON "story_runs"("user_id", "updated_at", "id");
CREATE INDEX "story_runs_template_version_id_idx" ON "story_runs"("template_version_id");

CREATE TABLE "story_turns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "turn_no" INTEGER NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "input_message_id" TEXT,
    "assistant_message_id" TEXT,
    "operation" TEXT NOT NULL,
    "state_status" TEXT NOT NULL DEFAULT 'PENDING',
    "state_attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "started_at" DATETIME NOT NULL,
    "committed_at" DATETIME,
    "lease_owner" TEXT,
    "lease_expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "story_turns_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "story_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_turns_input_message_id_fkey" FOREIGN KEY ("input_message_id") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "story_turns_assistant_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_turns_run_id_request_id_key" ON "story_turns"("run_id", "request_id");
CREATE UNIQUE INDEX "story_turns_run_id_turn_no_key" ON "story_turns"("run_id", "turn_no");
CREATE UNIQUE INDEX "story_turns_input_message_id_key" ON "story_turns"("input_message_id");
CREATE UNIQUE INDEX "story_turns_assistant_message_id_key" ON "story_turns"("assistant_message_id");
CREATE INDEX "story_turns_run_id_state_status_lease_expires_at_idx" ON "story_turns"("run_id", "state_status", "lease_expires_at");
CREATE INDEX "story_turns_run_id_turn_no_status_idx" ON "story_turns"("run_id", "turn_no", "status");

CREATE TABLE "story_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "source_turn_id" TEXT NOT NULL,
    "chapter_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload_json" TEXT NOT NULL,
    "source_message_id" TEXT,
    "invalidated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "story_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "story_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_events_source_turn_id_fkey" FOREIGN KEY ("source_turn_id") REFERENCES "story_turns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_events_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "story_events_run_id_source_turn_id_status_idx" ON "story_events"("run_id", "source_turn_id", "status");
CREATE INDEX "story_events_run_id_chapter_key_status_created_at_idx" ON "story_events"("run_id", "chapter_key", "status", "created_at");
CREATE INDEX "story_events_source_message_id_idx" ON "story_events"("source_message_id");

CREATE TABLE "story_checkpoints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "through_turn_no" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "state_json" TEXT NOT NULL,
    "invalidated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "story_checkpoints_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "story_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_checkpoints_run_id_through_turn_no_revision_key" ON "story_checkpoints"("run_id", "through_turn_no", "revision");
CREATE INDEX "story_checkpoints_run_id_invalidated_at_through_turn_no_idx" ON "story_checkpoints"("run_id", "invalidated_at", "through_turn_no");
