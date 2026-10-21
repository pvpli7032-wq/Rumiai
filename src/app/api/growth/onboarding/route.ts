import {NextResponse} from 'next/server';
import {jsonError, privateHeaders, requireUser, unauthorized} from '@/lib/http';
import {readOnboarding, saveOnboarding} from '@/lib/growth/onboarding-service';

export const dynamic = 'force-dynamic';

/** 新手引导：读当前状态与推荐角色（V3 表 22）。 */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  try {
    return NextResponse.json(await readOnboarding(user.userId), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/growth/onboarding', '引导信息读取失败，请稍后重试。');
  }
}

/** 保存引导结果；跳过的用户同样写入完成时间，不再被拉回引导页。 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  try {
    const body = await request.json().catch(() => ({}));
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as {interests?: unknown; skipped?: boolean} : {};
    return NextResponse.json(await saveOnboarding(user.userId, input), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/growth/onboarding', '引导保存失败，请稍后重试。');
  }
}
