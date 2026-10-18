import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {changeSiteContent} from '@/lib/site-content/management-service';
import {privateHeaders, readJson, siteContentErrorResponse} from '../../_response';

export async function PATCH(request: Request, {params}: {params: Promise<{type: string; id: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const parsed = await readJson(request); if (parsed.response) return parsed.response;
    const {type, id} = await params;
    return NextResponse.json(await changeSiteContent(auth.userId, type, id, parsed.input), {headers: privateHeaders});
  } catch (error) {return siteContentErrorResponse(error, 'PATCH /api/admin/site-content/[type]/[id]');}
}
