import {logWarning} from '@/lib/logger';
import {recordProductEvent, isProductEvent, type ProductEventName} from './product-events';

/**
 * 客户端埋点的服务端入口校验（V3 表 5 AnalyticsEvent 与归因）。
 *
 * 客户端只能上报「访问/开始/分享访问/转去聊天」这类它确实知道的事实；
 * 完成、投票、结案、注册由各自 owner 在结果落库后写，不经过这里。
 * 因此这里只校验形状与归属，不判断业务真伪。
 */

export class ProductEventError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'ProductEventError';
  }
}

/** properties 上限：条数与单值长度都收口，避免把埋点当存储用。 */
const MAX_PROPERTIES = 10;
const MAX_PROPERTY_KEY = 40;
const MAX_PROPERTY_STRING = 200;
const MAX_SUBJECT_KEY = 120;

export interface ProductEventInput {
  event: ProductEventName;
  subjectKey: string | null;
  properties: Record<string, string | number | boolean | null> | null;
}

/** properties 只接受标量；嵌套对象、数组、函数一律拒绝，不静默丢弃。 */
function parseProperties(value: unknown): Record<string, string | number | boolean | null> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ProductEventError('附加信息必须是键值对象。');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_PROPERTIES) throw new ProductEventError('附加信息最多 ' + MAX_PROPERTIES + ' 项。');
  const parsed: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (key.length === 0 || key.length > MAX_PROPERTY_KEY) throw new ProductEventError('附加信息的键名过长。');
    if (item === null || typeof item === 'boolean') { parsed[key] = item; continue; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new ProductEventError('附加信息只接受有限数值。');
      parsed[key] = item;
      continue;
    }
    if (typeof item === 'string') {
      if ([...item].length > MAX_PROPERTY_STRING) throw new ProductEventError('附加信息的文字过长。');
      parsed[key] = item;
      continue;
    }
    throw new ProductEventError('附加信息只接受文字、数字、布尔值或空值。');
  }
  return parsed;
}

function parseSubjectKey(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ProductEventError('业务标识必须是文字。');
  if (value.length > MAX_SUBJECT_KEY) throw new ProductEventError('业务标识过长。');
  return value;
}

/** 校验上报体。事件名必须在白名单内，否则 400，不落库。 */
export function parseProductEventInput(body: unknown): ProductEventInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProductEventError('上报数据格式不正确。');
  const record = body as Record<string, unknown>;
  if (typeof record.event !== 'string' || !record.event) throw new ProductEventError('缺少事件名。');
  if (!isProductEvent(record.event)) throw new ProductEventError('未知的事件类型。');
  return {
    event: record.event,
    subjectKey: parseSubjectKey(record.subjectKey),
    properties: parseProperties(record.properties),
  };
}

export interface ProductEventContext {
  userId: string | null;
  /** 匿名归属：登录用户不写，避免同一人多算一份。 */
  anonymousSubject: string | null;
}

/**
 * 落一条客户端事件。埋点失败只记日志：统计出问题不能影响页面。
 */
export async function recordClientProductEvent(input: ProductEventInput, context: ProductEventContext): Promise<void> {
  if (!context.userId && !context.anonymousSubject) {
    logWarning('product_event_no_identity', {event: input.event});
    return;
  }
  await recordProductEvent({
    event: input.event,
    userId: context.userId,
    anonymousSubject: context.userId ? null : context.anonymousSubject,
    subjectKey: input.subjectKey,
    ...(input.properties ? {properties: input.properties} : {}),
  });
}
