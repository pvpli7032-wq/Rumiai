import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {readManagedSiteContent} from '@/lib/site-content/management-service';
import {privateHeaders, siteContentErrorResponse} from './_response';

export async function GET(request: Request) {
  try {
    const auth = await getAdminRequestUser(request); if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await readManagedSiteContent(auth.userId), {headers: privateHeaders});
  } catch (error) {return siteContentErrorResponse(error, 'GET /api/admin/site-content');}
}
