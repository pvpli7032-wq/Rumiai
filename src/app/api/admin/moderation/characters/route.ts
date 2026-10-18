import {NextResponse} from 'next/server';
import {readCharacterReviewQueue} from '@/lib/characters/review-service';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';

export async function GET(request: Request) {
  try {
    const access = await requireAdmin(request, 'moderation.read');
    if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('此页面仅限审核人员访问。');
    return NextResponse.json(await readCharacterReviewQueue(access.user.userId), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/moderation/characters', '审核列表加载失败。');
  }
}
