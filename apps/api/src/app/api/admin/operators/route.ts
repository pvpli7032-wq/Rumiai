import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {readOperatorManagement, saveOperator} from '@rumiai/backend/modules/admin/management-service';
import {adminErrorResponse, privateHeaders} from '../_response';

export async function GET(request: Request) {
  try {
    const user = await getAdminRequestUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await readOperatorManagement(user.userId, params.get('q') ?? '', Number(params.get('page') ?? '1')), {headers: privateHeaders});
  } catch (error) {return adminErrorResponse(error, 'GET /api/admin/operators');}
}
export async function POST(request: Request) {
  try {
    const user = await getAdminRequestUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await saveOperator(user.userId, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {return adminErrorResponse(error, 'POST /api/admin/operators');}
}
