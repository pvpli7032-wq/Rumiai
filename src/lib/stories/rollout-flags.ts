import {StoryError} from './repository/contracts';

/**
 * Story 灰度旗标（F1–F4，V3 第 27 章「渐进上线」）。
 *
 * 与 STORY_WORKER_DISABLED 同口径：值为 "1"（trim 后比较）时生效，set env + 重启即生效，
 * 不依赖写库。旗标只落在 route 入口薄层、拒绝新工作：存量记录保留、只读可见，
 * 检查必须发生在任何额度预留之前，关闭不得影响普通聊天路径。
 */
function flagDisabled(flag: string): boolean {
  return process.env[flag]?.trim() === '1';
}

/** 命中关闭旗标时抛 503 SERVICE_DISABLED，经既有 storyErrorResponse 输出；文案不承诺恢复时间。 */
export function assertStoryActionEnabled(flag: string, message: string): void {
  if (flagDisabled(flag)) throw new StoryError('SERVICE_DISABLED', message, 503, {flag});
}
