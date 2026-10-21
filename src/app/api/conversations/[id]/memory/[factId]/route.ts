import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readJsonBody} from '@/lib/http';
import {logRouteError} from '@/lib/logger';
import {deleteMemoryFact, MemoryError, readMemorySettings, updateMemoryFact} from '@/lib/memory';

export const dynamic = 'force-dynamic';

/**
 * 编辑（text）与固定（pinned）一条记忆事实（V3 §25 表 21「事实」行）。
 *
 * 只接受这两个字段：内容校验、INVALID 编辑后回到 ACTIVE 都由 updateMemoryFact 负责，
 * 这里不重复实现一遍规则。归属沿用同一口径：别人的事实 403，跨会话或不存在 404。
 */
export async function PATCH(request: Request, {params}: {params: Promise<{id: string; factId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const {id, factId} = await params;
    const settings = await readMemorySettings(auth.userId);
    if (!settings.enabled) return NextResponse.json({error: '聊天记忆已关闭。'}, {status: 409});
    const body = await readJsonBody(request, {maxBytes: 2_000});
    if (body.response) return body.response;
    const input = (body.input ?? {}) as {text?: unknown; pinned?: unknown};
    if (input.pinned !== undefined && typeof input.pinned !== 'boolean') {
      return NextResponse.json({error: '固定状态只能是开或关。'}, {status: 400});
    }
    return NextResponse.json(await updateMemoryFact(auth.userId, factId, {text: input.text, pinned: input.pinned}, id));
  } catch (error) {
    if (error instanceof MemoryError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('PATCH /api/conversations/[id]/memory/[factId]', error);
    return NextResponse.json({error: '保存失败，请重试。'}, {status: 500});
  }
}

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
