import { NextResponse } from 'next/server';
import { getMediaAuthUser } from '@rumiai/backend/infrastructure/auth/auth-cookies';
import { readVisibleUpload } from '@rumiai/backend/modules/uploads/read-service';
import {readSiteContentImagePreview} from '@rumiai/backend/modules/site-content/management-service';
import { UploadError } from '@rumiai/backend/modules/uploads/storage-service';
import {SiteContentError} from '@rumiai/backend/modules/site-content/errors';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ name: string }> }) {
  const params = await paramsPromise;

  try {
    const user = await getMediaAuthUser(request);
    const previewPageId=new URL(request.url).searchParams.get('previewPage');
    const file = previewPageId&&user ? await readSiteContentImagePreview(user.userId,previewPageId,params.name) : await readVisibleUpload(params.name, user?.userId ?? null);
    return new Response(new Uint8Array(file.bytes), { headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (error instanceof UploadError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof SiteContentError) return NextResponse.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});
    logRouteError('GET /api/uploads/[name]', error);
    return NextResponse.json({ error: '图片暂时无法读取。' }, { status: 500 });
  }
}
