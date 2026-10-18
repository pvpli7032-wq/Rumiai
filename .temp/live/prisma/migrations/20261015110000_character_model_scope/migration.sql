ALTER TABLE "characters" ADD COLUMN "ai_models_restricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "characters" ADD COLUMN "ai_model_scope_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "character_ai_models" (
  "character_id" TEXT NOT NULL,
  "model_key" TEXT NOT NULL,
  PRIMARY KEY ("character_id", "model_key"),
  CONSTRAINT "character_ai_models_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "character_ai_models_model_key_fkey" FOREIGN KEY ("model_key") REFERENCES "ai_models" ("key") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "character_ai_models_model_key_idx" ON "character_ai_models"("model_key");
