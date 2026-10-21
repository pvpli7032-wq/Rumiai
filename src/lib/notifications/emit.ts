import {logWarning} from '@/lib/logger';

/**
 * 通知写入的容错边界（V3 §26）。
 *
 * 通知是主流程的附带产物：加币、审核、回复本身必须成功，通知失败不能回滚它们。
 * 所以四个生产者一律在**主流程事务提交之后**再 await 写通知，包在这里：
 * - 事务内写：通知失败会连累加币一起回滚，重试回调还可能把失败放大成支付异常；
 * - 事务外不 await（纯 fire-and-forget）：测试与调用方都看不到通知是否写成，行为不可预期；
 * - 事务提交后 await + 吞掉异常：主流程已经落库，通知要么写成、要么记一条日志，结果确定。
 *
 * 重复通知由 notificationId 的主键保证（同一用户 + 类型 + 事件键只落一行），
 * 不依赖这里的调用次数，所以重试、重放都安全。
 */
export async function notifySafely(producer: () => Promise<{id: string; created: boolean}>, context: string): Promise<void> {
  try {
    await producer();
  } catch (error) {
    logWarning('notification_write_failed', {context, error: error instanceof Error ? error.message : String(error)});
  }
}
