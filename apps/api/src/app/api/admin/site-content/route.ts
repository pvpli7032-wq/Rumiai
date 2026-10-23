import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {readManagedSiteContent} from '@rumiai/backend/modules/site-content/management-service';
import {privateHeaders, siteContentErrorResponse} from './_response';

export async function GET(request: Request) {
  try {
    const auth = await getAdminRequestUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await readManagedSiteContent(auth.userId), {headers: privateHeaders});
  } catch (error) {return siteContentErrorResponse(error, 'GET /api/admin/site-content');}
}
