import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {changeCircleSubscription} from '@rumiai/backend/modules/circles/service';
import {circleError, privateHeaders} from '../../_response';
export const dynamic = 'force-dynamic';
type Context = {params: Promise<{id: string}>};

async function change(request: Request, id: string, subscribe: boolean) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await changeCircleSubscription(auth.userId, id, subscribe), {headers: privateHeaders});
  } catch (error) {return circleError(error, 'circle subscription');}
}
export async function PUT(request: Request, {params}: Context) {
  return change(request, (await params).id, true);
}
export async function DELETE(request: Request, {params}: Context) {
  return change(request, (await params).id, false);
}
