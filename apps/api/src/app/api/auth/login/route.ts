import {NextResponse} from 'next/server';
import {loginWithPassword, AccountLoginError} from '@rumiai/backend/modules/accounts/login-service';
import {AuthConfigurationError} from '@rumiai/backend/infrastructure/auth/auth';
import {setMediaSessionCookie} from '@rumiai/backend/infrastructure/auth/auth-cookies';
import {clientIp} from '@rumiai/backend/infrastructure/http/client-ip';
import {checkRateLimit} from '@rumiai/backend/infrastructure/http/rate-limit';
import {readRateLimitRules} from '@rumiai/backend/modules/settings/limits';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

/**
 * 登录限流的分桶键：先认 nginx 写的 `x-real-ip`。
 *
 * 不用 `clientIp` 打头是有意的：它先看 X-Forwarded-For，而当前线上 vhost
 * （lh.y-98.cn）只设了 X-Real-IP、没设 X-Forwarded-For —— 请求里出现的 XFF
 * 全是客户端自己带的，按它分桶等于把限流开关交给攻击者，换一个头就换个桶。
 * nginx 的 `proxy_set_header X-Real-IP $remote_addr` 会覆盖同名请求头，这一份可信。
 * 没有该头时退回 `clientIp`（与其他限流同一套判断），再没有就并到一个桶里，
 * 宁可偶尔误伤也不放开。
 */
function loginSource(request: Request): string {
  return request.headers.get('x-real-ip')?.trim() || clientIp(request) || 'unknown';
}

export async function POST(request: Request) {
  try {
    // 每个登录尝试都计数（含成功）：设置项的名字就是「每窗口登录尝试」。
    // 限流在解析请求体之前，畸形请求同样消耗额度。
    const rules = await readRateLimitRules();
    const limit = checkRateLimit(`login:${loginSource(request)}`, rules.login.perWindow, rules.login.windowMs);
    if (!limit.allowed) {
      return NextResponse.json(
        {error: '登录尝试太频繁，请稍后再试。'},
        {status: 429, headers: {'Retry-After': String(limit.retryAfter)}},
      );
    }
    const result = await loginWithPassword(await request.json().catch(() => null));
    return setMediaSessionCookie(NextResponse.json(result), result.token);
  } catch (error) {
    if (error instanceof AccountLoginError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof AuthConfigurationError) return NextResponse.json({error: '账号服务尚未配置，请联系管理员。'}, {status: 503});
    logRouteError('POST /api/auth/login', error);
    return NextResponse.json({error: '登录失败，请稍后重试。'}, {status: 500});
  }
}
