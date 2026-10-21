/**
 * 玩法埋点的浏览器端上报（V3 表 5 / §26）。
 *
 * 与 trackSceneFunnelEvent 同一纪律：
 * - 静默失败：埋点永远不能干扰主流程，网络错误一律吞掉。
 * - keepalive：事件触发后页面可能立刻跳转，请求要能脱离页面生命周期存活。
 * - 不排队、不重试、不落本地状态：一次访问只发一次，统计口径由服务端 DISTINCT 决定。
 */
import {API} from '@/lib/api-paths';
import type {ProductEventName} from './product-events';

export type ProductEventProperties = Record<string, string | number | boolean | null>;

export function trackProductEvent(token: string | null | undefined, event: ProductEventName, options: {subjectKey?: string; properties?: ProductEventProperties} = {}): void {
  if (typeof window === 'undefined') return;
  const body: Record<string, unknown> = {event};
  if (options.subjectKey) body.subjectKey = options.subjectKey;
  if (options.properties) body.properties = options.properties;
  void fetch(API.events, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 匿名访客没有 token，归属靠服务端签发的 Cookie，所以这里不强制登录。
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {});
}
