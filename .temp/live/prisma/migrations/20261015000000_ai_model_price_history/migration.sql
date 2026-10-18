CREATE TABLE "ai_model_prices" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "model_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "input_per_million_micros" BIGINT NOT NULL,
  "output_per_million_micros" BIGINT NOT NULL,
  "effective_at" DATETIME NOT NULL,
  "source" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_prices_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_model_prices_currency_check" CHECK ("currency" GLOB '[A-Z][A-Z][A-Z]'),
  CONSTRAINT "ai_model_prices_nonnegative_check" CHECK ("input_per_million_micros" >= 0 AND "output_per_million_micros" >= 0),
  CONSTRAINT "ai_model_prices_source_check" CHECK (length(trim("source")) BETWEEN 1 AND 500),
  CONSTRAINT "ai_model_prices_reason_check" CHECK (length(trim("reason")) BETWEEN 1 AND 300)
);
CREATE UNIQUE INDEX "ai_model_prices_model_id_effective_at_key" ON "ai_model_prices"("model_id", "effective_at");
ALTER TABLE "ai_calls" ADD COLUMN "model_price_id" TEXT REFERENCES "ai_model_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ai_calls_model_price_id_idx" ON "ai_calls"("model_price_id");
