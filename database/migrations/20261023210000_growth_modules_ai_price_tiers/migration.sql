CREATE TABLE "growth_module_states" (
  "module_id" TEXT NOT NULL PRIMARY KEY,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "config_json" TEXT NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_by" TEXT,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "growth_module_states_module_id_check" CHECK ("module_id" IN ('missions','checkin','gifts')),
  CONSTRAINT "growth_module_states_config_json_check" CHECK (json_valid("config_json"))
);

INSERT INTO "growth_module_states" ("module_id","is_enabled","config_json","version") VALUES
  ('missions',true,'{}',0),
  ('checkin',true,'{}',0),
  ('gifts',true,'{}',0);

CREATE TABLE "ai_model_price_tiers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "price_id" TEXT NOT NULL,
  "min_input_tokens" INTEGER NOT NULL,
  "max_input_tokens" INTEGER,
  "input_per_million_micros" BIGINT NOT NULL,
  "output_per_million_micros" BIGINT NOT NULL,
  "cached_input_per_million_micros" BIGINT,
  "sort_order" INTEGER NOT NULL,
  CONSTRAINT "ai_model_price_tiers_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "ai_model_prices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_model_price_tiers_range_check" CHECK ("min_input_tokens" >= 0 AND ("max_input_tokens" IS NULL OR "max_input_tokens" > "min_input_tokens")),
  CONSTRAINT "ai_model_price_tiers_rate_check" CHECK ("input_per_million_micros" >= 0 AND "output_per_million_micros" >= 0 AND ("cached_input_per_million_micros" IS NULL OR "cached_input_per_million_micros" >= 0))
);
CREATE UNIQUE INDEX "ai_model_price_tiers_price_id_min_input_tokens_key" ON "ai_model_price_tiers"("price_id", "min_input_tokens");
CREATE INDEX "ai_model_price_tiers_price_id_sort_order_idx" ON "ai_model_price_tiers"("price_id", "sort_order");

ALTER TABLE "ai_calls" ADD COLUMN "model_price_tier_id" TEXT REFERENCES "ai_model_price_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_calls" ADD COLUMN "cost_audit_json" TEXT;
CREATE INDEX "ai_calls_model_price_tier_id_idx" ON "ai_calls"("model_price_tier_id");
