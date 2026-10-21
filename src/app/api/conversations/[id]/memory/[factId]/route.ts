import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {logRouteError} from '@/lib/logger';
import {deleteMemoryFact, MemoryError, readMemorySettings} from '@/lib/memory';

export const dynamic = 'force-dynamic';

/** 删除（软删除）一条记忆事实：只能删自己的。 */
export async function DELETE(request: Request, {params}: {params: Promise<{id: string; factId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const {id, factId} = await params;
    const settings = await readMemorySettings(auth.userId);
    if (!settings.enabled) return NextResponse.json({error: '聊天记忆已关闭。'}, {status: 409});
    return NextResponse.json(await deleteMemoryFact(auth.userId, factId, id));
  } catch (error) {
    if (error instanceof MemoryError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('DELETE /api/conversations/[id]/memory/[factId]', error);
    return NextResponse.json({error: '删除失败，请重试。'}, {status: 500});
  }
}
