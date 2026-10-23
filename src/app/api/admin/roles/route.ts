import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {saveRole} from '@/lib/admin/management-service';
import {adminErrorResponse, privateHeaders} from '../_response';

export async function POST(request: Request) {
  try {
    const user = await getAdminRequestUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await saveRole(user.userId, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {return adminErrorResponse(error, 'POST /api/admin/roles');}
}
