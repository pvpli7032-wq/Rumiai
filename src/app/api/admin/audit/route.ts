import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {readAdminAudit} from '@/lib/admin/management-service';
import {adminErrorResponse, privateHeaders} from '../_response';

export async function GET(request: Request) {
  try {
    const user = await getAdminRequestUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const params=new URL(request.url).searchParams;
    const filters=Object.fromEntries(['actorId','targetId','action','from','until'].map(key=>[key,params.get(key)??'']));
    return NextResponse.json(await readAdminAudit(user.userId, Number(params.get('page') ?? '1'),filters), {headers: privateHeaders});
  } catch (error) {return adminErrorResponse(error, 'GET /api/admin/audit');}
}
