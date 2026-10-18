ALTER TABLE "coin_transactions" ADD COLUMN "source_key" TEXT NOT NULL DEFAULT 'OTHER';
UPDATE "coin_transactions" SET "source_key"='CHECKIN_REWARD' WHERE "type"='EARNED' AND "description" LIKE '每日签到第 %';
UPDATE "coin_transactions" SET "source_key"='MISSION_REWARD' WHERE "type"='EARNED' AND "description" LIKE '任务奖励：%';
UPDATE "coin_transactions" SET "source_key"='CHARACTER_QUEST_REWARD' WHERE "type"='EARNED' AND "description" LIKE 'ภารกิจตัวละคร: %';
UPDATE "coin_transactions" SET "source_key"='PAYMENT_PURCHASE' WHERE "type"='PURCHASE';
UPDATE "coin_transactions" SET "source_key"='REFUND_RELEASE' WHERE "type"='REFUND_RELEASE';
UPDATE "coin_transactions" SET "source_key"='REFUND_RESERVATION' WHERE "type"='REFUND';
UPDATE "coin_transactions" SET "source_key"='GIFT_PURCHASE' WHERE "type"='SPENT' AND "description" LIKE '赠送礼物 %';
CREATE INDEX "coin_transactions_source_key_created_at_idx" ON "coin_transactions"("source_key", "created_at");
