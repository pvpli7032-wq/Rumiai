CREATE TABLE "invite_codes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expires_at" DATETIME,
  "max_uses" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "disabled_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invite_codes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");
CREATE UNIQUE INDEX "invite_codes_owner_id_key" ON "invite_codes"("owner_id");

CREATE TABLE "referral_relationships" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "inviter_id" TEXT NOT NULL,
  "invitee_id" TEXT NOT NULL,
  "invite_code_id" TEXT NOT NULL,
  "bound_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_relationships_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "referral_relationships_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "referral_relationships_invite_code_id_fkey" FOREIGN KEY ("invite_code_id") REFERENCES "invite_codes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "referral_relationships_invitee_id_key" ON "referral_relationships"("invitee_id");
CREATE UNIQUE INDEX "referral_relationships_inviter_id_invitee_id_key" ON "referral_relationships"("inviter_id", "invitee_id");
CREATE INDEX "referral_relationships_inviter_id_bound_at_idx" ON "referral_relationships"("inviter_id", "bound_at");

CREATE TABLE "affiliate_accruals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_type" TEXT NOT NULL,
  "source_order_id" TEXT NOT NULL,
  "beneficiary_user_id" TEXT NOT NULL,
  "referred_user_id" TEXT NOT NULL,
  "relationship_id" TEXT NOT NULL,
  "base_amount_cents" INTEGER NOT NULL,
  "commission_bps" INTEGER NOT NULL,
  "commission_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "available_at" DATETIME NOT NULL,
  "processed_at" DATETIME,
  "refunded_base_cents" INTEGER NOT NULL DEFAULT 0,
  "reversed_cents" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_accruals_beneficiary_user_id_fkey" FOREIGN KEY ("beneficiary_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "affiliate_accruals_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "affiliate_accruals_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "referral_relationships" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "affiliate_accruals_source_type_source_order_id_key" ON "affiliate_accruals"("source_type", "source_order_id");
CREATE INDEX "affiliate_accruals_beneficiary_user_id_status_available_at_idx" ON "affiliate_accruals"("beneficiary_user_id", "status", "available_at");
CREATE INDEX "affiliate_accruals_referred_user_id_created_at_idx" ON "affiliate_accruals"("referred_user_id", "created_at");

CREATE TABLE "affiliate_reversals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accrual_id" TEXT NOT NULL,
  "refund_key" TEXT NOT NULL,
  "refund_base_amount_cents" INTEGER NOT NULL,
  "reversed_commission_cents" INTEGER NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_reversals_accrual_id_fkey" FOREIGN KEY ("accrual_id") REFERENCES "affiliate_accruals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "affiliate_reversals_refund_key_key" ON "affiliate_reversals"("refund_key");
CREATE INDEX "affiliate_reversals_accrual_id_created_at_idx" ON "affiliate_reversals"("accrual_id", "created_at");

-- Preserve every existing invitation without changing its historical bound time.
INSERT INTO "invite_codes" ("id", "owner_id", "code", "status", "created_at", "updated_at")
SELECT 'legacy-code:' || "id", "id", "invite_code", 'ACTIVE', "created_at", CURRENT_TIMESTAMP
FROM "users" WHERE "invite_code" IS NOT NULL;

INSERT INTO "referral_relationships" ("id", "inviter_id", "invitee_id", "invite_code_id", "bound_at")
SELECT 'legacy-rel:' || child."id", parent."id", child."id", 'legacy-code:' || parent."id", child."created_at"
FROM "users" child JOIN "users" parent ON parent."id" = child."invited_by_user_id"
WHERE parent."invite_code" IS NOT NULL AND child."id" <> parent."id";

UPDATE "invite_codes"
SET "used_count" = (SELECT COUNT(*) FROM "referral_relationships" r WHERE r."invite_code_id" = "invite_codes"."id");
