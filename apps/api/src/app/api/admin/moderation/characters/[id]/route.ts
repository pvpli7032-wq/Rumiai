import {NextResponse} from 'next/server';
import {reviewCharacter} from '@rumiai/backend/modules/characters/review-service';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export async function PUT(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const access = await requireAdmin(request, 'moderation.write');
    if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('此操作仅限审核人员。');
    return NextResponse.json(await reviewCharacter(access.user.userId, (await context.params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PUT /api/admin/moderation/characters/[id]', '审核保存失败，请稍后重试。');
  }
}
