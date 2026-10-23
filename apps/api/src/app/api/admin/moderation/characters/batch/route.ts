import {NextResponse} from 'next/server';
import {reviewCharacters} from '@rumiai/backend/modules/characters/review-service';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export async function POST(request: Request) {
  try {
    const access = await requireAdmin(request, 'moderation.write');
    if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('此操作仅限审核人员。');
    return NextResponse.json(await reviewCharacters(access.user.userId, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/moderation/characters/batch', '批量审核失败，请稍后重试。');
  }
}
