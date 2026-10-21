import {NextResponse} from 'next/server';
import {jsonError, privateHeaders, requireUser, unauthorized} from '@/lib/http';
import {ensureInviteCode, readInviteSettings} from '@/lib/growth/invite-service';

export const dynamic = 'force-dynamic';

/**
 * 本人的邀请码与分享链接（V3 表 9 增长「邀请奖励」）。
 *
 * 关闭时不生成码也不报错，前端据 enabled 决定是否展示入口。
 */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  try {
    const settings = await readInviteSettings();
    if (!settings.enabled) return NextResponse.json({enabled: false, code: null, link: null, rewardCoins: settings.rewardCoins}, {headers: privateHeaders});
    const code = await ensureInviteCode(user.userId);
    const origin = new URL(request.url).origin;
    return NextResponse.json({enabled: true, code, link: `${origin}/register?invite=${encodeURIComponent(code)}`, rewardCoins: settings.rewardCoins}, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/growth/invite', '邀请信息读取失败，请稍后重试。');
  }
}
