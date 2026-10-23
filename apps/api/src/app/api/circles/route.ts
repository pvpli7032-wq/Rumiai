import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {createCircle, listCircles} from '@rumiai/backend/modules/circles/service';
import {circleError, privateHeaders} from './_response';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    const params = new URL(request.url).searchParams;
    const circles = await listCircles(auth?.userId ?? null, {scope: params.get('scope'), search: params.get('search') ?? ''});
    return NextResponse.json(circles, {headers: privateHeaders});
  } catch (error) {return circleError(error, 'GET /api/circles');}
}
export async function POST(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    let input: unknown;
    try {input = await request.json();}
    catch {return NextResponse.json({error: '圈子数据格式不正确。'}, {status: 400, headers: privateHeaders});}
    return NextResponse.json(await createCircle(auth.userId, input), {status: 201, headers: privateHeaders});
  } catch (error) {return circleError(error, 'POST /api/circles');}
}
