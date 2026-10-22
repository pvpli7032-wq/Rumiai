import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {newMirrorSubject, readCookie} from '@/lib/mirror/share';
import {MIRROR_SUBJECT_COOKIE} from '@/lib/mirror/types';
import {recordInviteVisit} from '@/lib/growth/invite-service';
import {logRouteError} from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * 邀请链接的落地口（V3 表 22 邀请与分享「记录分享来源、访问、注册及首次聊天」）。
 *
 * 分享出去的链接指向这里，不是直接指向 /register：访问这一环只有服务端看得见——
 * 浏览器自己上报「我访问了」分不清是人、是预取还是刷量。这里记完就 302 到注册页，
 * 用户看到的还是原来的注册表单，邀请码照旧带在 ?invite= 上。
 *
 * 记不上也照常跳转：埋点坏了不能让人打不开注册页。
 */
const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{1,32}$/;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function GET(request: Request) {
  const code = (new URL(request.url).searchParams.get('code') ?? '').trim().toUpperCase();
  const response = NextResponse.redirect(new URL(code ? `/register?invite=${encodeURIComponent(code)}` : '/register', request.url), 302);
  if (!CODE_PATTERN.test(code)) return response;
  try {
    const auth = await getAuthUser(request);
    const existing = auth ? null : readCookie(request.headers.get('cookie'), MIRROR_SUBJECT_COOKIE);
    // 首次来的访客还没有匿名主体：现签发一个并随跳转写回，否则这次访问归不到任何人。
    const anonymousSubject = auth ? null : existing ?? newMirrorSubject();
    await recordInviteVisit({inviteCode: code, userId: auth?.userId ?? null, anonymousSubject});
    if (anonymousSubject && !existing) {
      response.cookies.set({name: MIRROR_SUBJECT_COOKIE, value: anonymousSubject, maxAge: COOKIE_MAX_AGE, httpOnly: true, sameSite: 'lax', path: '/'});
    }
  } catch (error) {
    logRouteError('GET /api/growth/invite/visit', error);
  }
  return response;
}
