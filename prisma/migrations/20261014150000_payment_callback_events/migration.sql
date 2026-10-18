CREATE TABLE "payment_callback_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "payment_order_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_trade_no" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_callback_events_payment_order_id_fkey"
    FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "payment_callback_events_payment_order_id_received_at_idx"
  ON "payment_callback_events"("payment_order_id", "received_at");
CREATE INDEX "payment_callback_events_provider_received_at_idx"
  ON "payment_callback_events"("provider", "received_at");
