ALTER TABLE "story_runs" ADD COLUMN "settings_json" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "conversations" ADD COLUMN "scene_id" TEXT;
