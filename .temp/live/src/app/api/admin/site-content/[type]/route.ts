import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {changeSiteContent} from '@/lib/site-content/management-service';
import {privateHeaders, readJson, siteContentErrorResponse} from '../_response';

export async function POST(request: Request, {params}: {params: Promise<{type: string}>}) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const parsed = await readJson(request); if (parsed.response) return parsed.response;
    return NextResponse.json(await changeSiteContent(auth.userId, (await params).type, null, parsed.input), {status: 201, headers: privateHeaders});
  } catch (error) {return siteContentErrorResponse(error, 'POST /api/admin/site-content/[type]');}
}
