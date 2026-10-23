import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {listSiteContentRevisions} from '@/lib/site-content/management-service';
import {privateHeaders, siteContentErrorResponse} from '../../../_response';

export async function GET(request: Request, {params}: {params: Promise<{type: string; id: string}>}) {
  try {
    const auth = await getAdminRequestUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const {type, id} = await params;
    return NextResponse.json(await listSiteContentRevisions(auth.userId, type, id), {headers: privateHeaders});
  } catch (error) {return siteContentErrorResponse(error, 'GET /api/admin/site-content/[type]/[id]/revisions');}
}
