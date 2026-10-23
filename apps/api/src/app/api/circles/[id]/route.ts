import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {readCircle} from '@rumiai/backend/modules/circles/service';
import {circleError, privateHeaders} from '../_response';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const user = await getAuthUser(request);
    return NextResponse.json(await readCircle(user?.userId ?? null, (await params).id), {headers: privateHeaders});
  } catch (error) {return circleError(error, 'GET /api/circles/[id]');}
}
