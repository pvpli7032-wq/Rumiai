import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {hashMirrorIp, mirrorIpSalt, readCookie} from '@/lib/mirror/share';
import {MIRROR_SUBJECT_COOKIE} from '@/lib/mirror/types';
import {checkRateLimit} from '@/lib/rate-limit';
import {jsonError, privateHeaders, readJsonBody} from '@/lib/http';
import {ProductEventError, parseProductEventInput, recordClientProductEvent} from '@/lib/analytics/product-events-service';

export const dynamic = 'force-dynamic';

/**
 * 玩法埋点上报（V3 表 5）。
 *
 * - 匿名可用：没有登录态时用服务端签发的匿名主体 Cookie 做归属，绝不拿 IP 当身份。
 * - 登录用户自动带 userId，不再写匿名标识，避免同一人多算一份。
 * - 限流两路：按用户（或匿名主体）与按来源 IP 各一层，防止刷量。
 * - 只写客户端确实知道的事实；完成/投票/结案/注册由各业务 owner 服务端写。
 */

const WINDOW_MS = 60_000;
const PER_IDENTITY = 40;
const PER_IP = 120;

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || null;
}

export async function POST(request: Request) {
  const auth = await getAuthUser(request);
  const cookieHeader = request.headers.get('cookie');
  const anonymousSubject = auth ? null : readCookie(cookieHeader, MIRROR_SUBJECT_COOKIE);
  const ipHash = hashMirrorIp(clientIp(request), mirrorIpSalt());

  const identityKey = auth ? 'u:' + auth.userId : anonymousSubject ? 'a:' + anonymousSubject : null;
  if (identityKey && !checkRateLimit('product-event:' + identityKey, PER_IDENTITY, WINDOW_MS).allowed) {
    return NextResponse.json({error: '上报过于频繁，请稍后再试。', code: 'RATE_LIMITED'}, {status: 429, headers: privateHeaders});
  }
  if (ipHash && !checkRateLimit('product-event-ip:' + ipHash, PER_IP, WINDOW_MS).allowed) {
    return NextResponse.json({error: '上报过于频繁，请稍后再试。', code: 'RATE_LIMITED'}, {status: 429, headers: privateHeaders});
  }

  const body = await readJsonBody(request, {maxBytes: 4_000});
  if (body.response) return body.response;
  try {
    const input = parseProductEventInput(body.input);
    await recordClientProductEvent(input, {userId: auth?.userId ?? null, anonymousSubject});
    return new NextResponse(null, {status: 204, headers: privateHeaders});
  } catch (error) {
    if (error instanceof ProductEventError) {
      return NextResponse.json({error: error.message, code: 'INVALID_INPUT'}, {status: error.status, headers: privateHeaders});
    }
    return jsonError(error, 'POST /api/events', '埋点上报失败。');
  }
}
