/**
 * 后台运营接口（Mirror 结果 / 评理案例 / 后台任务 / 模型币价 / 费用单）共用的小工具。
 *
 * 只放参数解析与领域错误：错误体统一由 packages/backend/src/infrastructure/http 的 jsonError 生成，这里不新造格式。
 */

export class AdminOpsError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

/** 游标：不透明字符串，只接受安全字符，避免把任意内容拼进查询。 */
export function cursorParam(value: string | null): string | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_:.~-]{1,120}$/.test(value)) throw new AdminOpsError('分页游标无效，请刷新后重试。');
  return value;
}

/** 每页条数：默认值与上限都收口在这里，路由不再各自 Math.min。 */
export function limitParam(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AdminOpsError('每页条数必须是大于 0 的整数。');
  return Math.min(max, parsed);
}

/** 状态过滤：只接受登记过的取值；空值表示不过滤。 */
export function statusParam<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (!value) return null;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new AdminOpsError('状态筛选无效，可选：' + allowed.join('、') + '。');
  }
  return value as T;
}

/** 必填的实体 id：只校验形状，不存在交给调用方判断 404。 */
export function idParam(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new AdminOpsError('目标标识无效。');
  return value;
}
