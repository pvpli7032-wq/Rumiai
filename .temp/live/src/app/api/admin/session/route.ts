import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readAdminAuthorization} from '@/lib/admin/authorization';
import {adminErrorResponse, privateHeaders} from '../_response';

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await readAdminAuthorization(user.userId), {headers: privateHeaders});
  } catch (error) {return adminErrorResponse(error, 'GET /api/admin/session');}
}
