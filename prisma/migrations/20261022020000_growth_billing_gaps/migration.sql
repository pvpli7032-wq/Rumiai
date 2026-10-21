-- V3 补齐：每日免费取消额度、新手引导与邀请归属、奖励幂等键。
-- 都是新增可空列或带默认值的列，不动已有数据，不做表重建。

-- 1) 每日免费取消额度（V3 表 8 billing.freeCancelPerDay、表 16 用户取消）
ALTER TABLE "user_daily_allowances" ADD COLUMN "free_cancel_used" INTEGER NOT NULL DEFAULT 0;

-- 2) 新手引导：兴趣标签与完成时间（V3 表 9 增长、表 22）
ALTER TABLE "users" ADD COLUMN "interests_json" TEXT;
ALTER TABLE "users" ADD COLUMN "onboarded_at" DATETIME;

-- 3) 邀请：本人邀请码与注册时的邀请人归属（V3 表 9 增长、表 22）
ALTER TABLE "users" ADD COLUMN "invite_code" TEXT;
ALTER TABLE "users" ADD COLUMN "invited_by_user_id" TEXT;
CREATE UNIQUE INDEX "users_invite_code_key" ON "users"("invite_code");
CREATE INDEX "users_invited_by_user_id_idx" ON "users"("invited_by_user_id");

-- 4) 奖励幂等键：评理参与奖与热门奖同一业务键只发一次（V3 表 20 奖励）
ALTER TABLE "coin_transactions" ADD COLUMN "reward_key" TEXT;
CREATE UNIQUE INDEX "coin_transactions_reward_key_key" ON "coin_transactions"("reward_key");
