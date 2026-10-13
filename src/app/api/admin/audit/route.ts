import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readAdminAudit} from '@/lib/admin/management-service';
import {adminErrorResponse, privateHeaders} from '../_response';

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await readAdminAudit(user.userId, Number(new URL(request.url).searchParams.get('page') ?? '1')), {headers: privateHeaders});
  } catch (error) {return adminErrorResponse(error, 'GET /api/admin/audit');}
}
