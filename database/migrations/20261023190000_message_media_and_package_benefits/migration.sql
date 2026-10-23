ALTER TABLE "coin_packages" ADD COLUMN "benefits_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "payment_orders" ADD COLUMN "package_benefits_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "upload_assets" ADD COLUMN "mime_type" TEXT;
ALTER TABLE "upload_assets" ADD COLUMN "byte_size" INTEGER;
ALTER TABLE "messages" ADD COLUMN "media_request_id" TEXT;
ALTER TABLE "messages" ADD COLUMN "media_request_hash" TEXT;
CREATE UNIQUE INDEX "messages_conversation_id_media_request_id_key" ON "messages"("conversation_id", "media_request_id");

CREATE TABLE "message_attachments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "message_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "upload_asset_id" TEXT,
  "sticker_id" TEXT,
  "mime_type" TEXT,
  "byte_size" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "message_attachments_upload_asset_id_fkey" FOREIGN KEY ("upload_asset_id") REFERENCES "upload_assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments"("message_id");
CREATE INDEX "message_attachments_upload_asset_id_idx" ON "message_attachments"("upload_asset_id");
