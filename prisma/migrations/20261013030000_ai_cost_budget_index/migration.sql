-- Preserve existing call records; support per-currency daily budget reads.
CREATE INDEX "ai_calls_currency_started_at_idx" ON "ai_calls"("currency", "started_at");
