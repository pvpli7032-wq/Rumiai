import {NextResponse} from 'next/server';
import {loginAdminWithPassword} from '@rumiai/backend/modules/admin-auth/service';
import {isAdminOriginAllowed, readAdminSessionCookie, setAdminSessionCookie} from '@rumiai/backend/modules/admin-auth/cookies';
import {revokeAdminSession} from '@rumiai/backend/modules/admin-auth/service';
import {readJsonBody} from '@rumiai/backend/infrastructure/http/body';
import {privateHeaders, jsonError} from '@rumiai/backend/infrastructure/http/errors';
import {clientIp} from '@rumiai/backend/infrastructure/http/client-ip';
import {checkRateLimit} from '@rumiai/backend/infrastructure/http/rate-limit';
import {readRateLimitRules} from '@rumiai/backend/modules/settings/limits';

function loginSource(request: Request) { return request.headers.get('x-real-ip')?.trim() || clientIp(request) || 'unknown'; }

export async function POST(request: Request) {
  try {
    if (!isAdminOriginAllowed(request)) return NextResponse.json({error: '后台请求来源不正确。'}, {status: 403});
    const rules = await readRateLimitRules();
    const limit = checkRateLimit(`admin-login:${loginSource(request)}`, rules.login.perWindow, rules.login.windowMs);
    if (!limit.allowed) return NextResponse.json({error: '登录尝试太频繁，请稍后再试。'}, {status: 429, headers: {'Retry-After': String(limit.retryAfter)}});
    const parsed = await readJsonBody(request, {maxBytes: 4096});
    if (parsed.response) return parsed.response;
    const result = await loginAdminWithPassword(parsed.input);
    await revokeAdminSession(readAdminSessionCookie(request));
    const {sessionToken, ...publicResult} = result;
    return setAdminSessionCookie(NextResponse.json(publicResult, {headers: privateHeaders}), sessionToken);
  } catch (error) {
    return jsonError(error, 'POST /api/admin/auth/login', '后台登录失败，请稍后重试。');
  }
}
