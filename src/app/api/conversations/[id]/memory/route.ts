import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {logRouteError} from '@/lib/logger';
import {listPanelFacts, MemoryError, readMemorySettings} from '@/lib/memory';

export const dynamic = 'force-dynamic';

/**
 * 聊天页记忆面板（V3 §25）。
 *
 * 记忆关闭时直接回 enabled=false 且不列任何事实：面板据此整个不渲染，
 * 也不需要前端去读设置中心（那是后台专用的）。
 */
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const {id} = await params;
    const settings = await readMemorySettings(auth.userId);
    if (!settings.enabled) return NextResponse.json({enabled: false, facts: []});
    return NextResponse.json({enabled: true, facts: await listPanelFacts(auth.userId, id)});
  } catch (error) {
    if (error instanceof MemoryError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('GET /api/conversations/[id]/memory', error);
    return NextResponse.json({error: '读取记忆失败，请重试。'}, {status: 500});
  }
}
