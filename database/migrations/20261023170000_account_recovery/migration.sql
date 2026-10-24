ALTER TABLE "users" ADD COLUMN "email_verified_at" DATETIME;

CREATE TABLE "account_action_tokens" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" DATETIME NOT NULL,
  "used_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_action_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_action_tokens_token_hash_key" ON "account_action_tokens"("token_hash");
CREATE INDEX "account_action_tokens_user_id_purpose_expires_at_idx" ON "account_action_tokens"("user_id", "purpose", "expires_at");
