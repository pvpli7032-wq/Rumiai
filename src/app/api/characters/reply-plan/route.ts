import {NextResponse} from 'next/server';
import {readReplyPlan} from '@/lib/billing/reader-plan';
import {jsonError, privateHeaders} from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * 角色详情页的「可用模型与费用」（V3 表 15）。
 *
 * 详情页预渲染在构建期，而模型币价与收费开关随时会改，所以价格不给页面算、
 * 也不进页面缓存：页面只说明有这一栏，数值由这里按角色现算。
 * 模型清单与币价都来自 @/lib/billing 与 readAiModelCatalog，与聊天页、预扣结算同源。
 */
export async function GET(request: Request) {
  const characterId = new URL(request.url).searchParams.get('characterId');
  if (!characterId || characterId.length > 100) {
    return NextResponse.json({error: '角色编号无效。', code: 'BAD_REQUEST'}, {status: 400, headers: privateHeaders});
  }
  try {
    return NextResponse.json(await readReplyPlan(characterId), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/characters/reply-plan', '费用读取失败，请稍后重试。');
  }
}
