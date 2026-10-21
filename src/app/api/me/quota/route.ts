import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {quoteReplyPrice} from '@/lib/billing/price';
import {readDailyAllowance} from '@/lib/billing/allowance';
import {jsonError, privateHeaders, requireUser, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * 登录用户的额度视图：余额、每条回复币价、今日免费次数与重置时刻。
 *
 * 币价与业务日口径只来自 @/lib/billing（倍率、默认模型取价、免费额度预占都在那一份实现里），
 * 这里不重复计算（V3 §5）。chargingEnabled 关闭时币价为 0，前端按「免费」显示。
 */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  try {
    const [account, price, allowance] = await Promise.all([
      db.user.findUnique({where: {id: user.userId}, select: {coins: true}}),
      quoteReplyPrice({userId: user.userId, operation: 'CHAT_SEND'}),
      readDailyAllowance(user.userId),
    ]);
    if (!account) return NextResponse.json({error: '账号不存在或已注销。', code: 'NOT_FOUND'}, {status: 404, headers: privateHeaders});
    return NextResponse.json({
      balance: account.coins,
      coinsPerReply: price.coins,
      baseCoinsPerReply: price.baseCoins,
      multiplier: price.multiplier,
      pricing: price.pricing,
      freeDaily: allowance.freeLimit,
      freeUsed: allowance.freeUsed,
      freeRemaining: allowance.freeRemaining,
      timezone: allowance.timezone,
      resetAt: allowance.resetAt,
    }, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/me/quota', '额度信息读取失败，请稍后重试。');
  }
}
