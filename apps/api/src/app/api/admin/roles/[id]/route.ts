import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {deleteRole} from '@rumiai/backend/modules/admin/management-service';
import {adminErrorResponse, privateHeaders} from '../../_response';

export async function DELETE(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const user = await getAdminRequestUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await deleteRole(user.userId, (await params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {return adminErrorResponse(error, 'DELETE /api/admin/roles/[id]');}
}
