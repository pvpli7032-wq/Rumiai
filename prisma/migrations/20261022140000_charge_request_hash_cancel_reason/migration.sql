-- V3 §20/§157：费用单补两项对账必需的信息。
-- 都是可空列，不动已有数据，不做表重建；旧费用单为 NULL 表示「当时没有记录」。

-- 1) 请求内容摘要：同一 (userId, operation, requestId) 换了内容要报冲突，
--    不能静默回放上一次的结果（V3 §20「相同编号却提交不同内容应返回冲突」）。
ALTER TABLE "generation_charges" ADD COLUMN "request_hash" TEXT;

-- 2) 取消原因：已输出后取消按计费时也要把原因写进费用单，便于对账（V3 §157）。
ALTER TABLE "generation_charges" ADD COLUMN "cancel_reason" TEXT;
