-- V0 场景漏斗埋点：纯增量新表，与 SceneFunnelEvent 模型对应。
CREATE TABLE "scene_funnel_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "scene_funnel_events_user_id_conversation_id_event_key" ON "scene_funnel_events"("user_id", "conversation_id", "event");
CREATE INDEX "scene_funnel_events_created_at_idx" ON "scene_funnel_events"("created_at");
