import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {MemoryError, readMemorySettings, confirmMemoryFact} from '@rumiai/backend/modules/memory/index';

export const dynamic = 'force-dynamic';

/** 只能操作自己的事实：跨用户一律 403，会话或事实不存在一律 404。 */
export async function POST(request: Request, {params}: {params: Promise<{id: string; factId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const {id, factId} = await params;
    const settings = await readMemorySettings(auth.userId);
    if (!settings.enabled) return NextResponse.json({error: '聊天记忆已关闭。'}, {status: 409});
    return NextResponse.json(await confirmMemoryFact(auth.userId, factId, id));
  } catch (error) {
    if (error instanceof MemoryError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('POST memory fact', error);
    return NextResponse.json({error: '操作失败，请重试。'}, {status: 500});
  }
}
