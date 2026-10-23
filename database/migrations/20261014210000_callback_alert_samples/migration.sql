CREATE TABLE "payment_callback_alert_samples" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "minute_start" DATETIME NOT NULL,
  "reason_code" TEXT NOT NULL,
  "first_seen_at" DATETIME NOT NULL,
  "last_seen_at" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "payment_callback_alert_samples_provider_minute_start_reason_code_key"
  ON "payment_callback_alert_samples"("provider", "minute_start", "reason_code");
CREATE INDEX "payment_callback_alert_samples_minute_start_provider_idx"
  ON "payment_callback_alert_samples"("minute_start", "provider");
