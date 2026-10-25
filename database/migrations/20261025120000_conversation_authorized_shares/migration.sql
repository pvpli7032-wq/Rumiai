CREATE TABLE "conversation_shares" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "conversation_id" TEXT NOT NULL,
 "snapshot_json" TEXT NOT NULL,
 "source_digest" TEXT NOT NULL,
 "message_count" INTEGER NOT NULL,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "revoked_at" DATETIME,
 CONSTRAINT "conversation_shares_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "conversation_shares_conversation_id_revoked_at_idx" ON "conversation_shares"("conversation_id","revoked_at");

CREATE TABLE "chat_suggestion_requests" (
 "id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "conversation_id" TEXT NOT NULL,
 "request_id" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PROCESSING',
 "suggestions_json" TEXT, "error_code" TEXT, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "finished_at" DATETIME,
 FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "chat_suggestion_requests_user_id_conversation_id_request_id_key" ON "chat_suggestion_requests"("user_id","conversation_id","request_id");
CREATE INDEX "chat_suggestion_requests_user_id_created_at_idx" ON "chat_suggestion_requests"("user_id","created_at");

CREATE TABLE "conversation_relationship_events" (
 "id" TEXT NOT NULL PRIMARY KEY, "conversation_id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "message_id" TEXT,
 "romance_delta" INTEGER NOT NULL, "intimacy_delta" INTEGER NOT NULL, "romance_after" INTEGER NOT NULL, "intimacy_after" INTEGER NOT NULL,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "conversation_relationship_events_conversation_id_request_id_key" ON "conversation_relationship_events"("conversation_id","request_id");
CREATE INDEX "conversation_relationship_events_conversation_id_created_at_idx" ON "conversation_relationship_events"("conversation_id","created_at");
