import {NextResponse} from 'next/server';
import {reviewCommunityAppeal} from '@/lib/community/moderation-service';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';

export async function PATCH(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const access = await requireAdmin(request, 'moderation.write');
    if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('此操作仅限审核人员。');
    const result = await reviewCommunityAppeal(access.user.userId, (await context.params).id, await request.json().catch(() => null));
    return NextResponse.json(result, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PATCH /api/admin/moderation/appeals/[id]', '申诉复核失败。');
  }
}
