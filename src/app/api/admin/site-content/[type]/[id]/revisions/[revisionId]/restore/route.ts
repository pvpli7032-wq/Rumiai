import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {restoreSiteContentRevision} from '@/lib/site-content/management-service';
import {privateHeaders, readJson, siteContentErrorResponse} from '../../../../../_response';

export async function POST(request: Request, {params}: {params: Promise<{type: string; id: string; revisionId: string}>}) {
  try {
    const auth = await getAdminRequestUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const parsed = await readJson(request); if (parsed.response) return parsed.response;
    const {type, id, revisionId} = await params;
    return NextResponse.json(await restoreSiteContentRevision(auth.userId, type, id, revisionId, parsed.input), {headers: privateHeaders});
  } catch (error) {return siteContentErrorResponse(error, 'POST /api/admin/site-content/[type]/[id]/revisions/[revisionId]/restore');}
}
