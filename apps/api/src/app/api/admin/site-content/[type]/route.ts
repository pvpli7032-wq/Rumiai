import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {changeSiteContent} from '@rumiai/backend/modules/site-content/management-service';
import {privateHeaders, readJson, siteContentErrorResponse} from '../_response';

export async function POST(request: Request, {params}: {params: Promise<{type: string}>}) {
  try {
    const auth = await getAdminRequestUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const parsed = await readJson(request); if (parsed.response) return parsed.response;
    return NextResponse.json(await changeSiteContent(auth.userId, (await params).type, null, parsed.input), {status: 201, headers: privateHeaders});
  } catch (error) {return siteContentErrorResponse(error, 'POST /api/admin/site-content/[type]');}
}
