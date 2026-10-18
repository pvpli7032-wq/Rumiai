import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { saveAccountUpload, UploadError } from '@/lib/uploads/storage-service';

export const runtime = 'nodejs';

/** Uploads land on disk, so cap how fast one account can fill it. */
const UPLOAD_LIMIT = Number(process.env.UPLOAD_RATE_LIMIT) || 20;
const UPLOAD_WINDOW_MS = Number(process.env.UPLOAD_RATE_WINDOW_MS) || 600_000;

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = checkRateLimit(`upload:${authUser.userId}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: '上传过于频繁，请稍后再试。' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
      );
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '请选择要上传的图片。' }, { status: 400 });
    }

    return NextResponse.json(await saveAccountUpload(authUser.userId, file));
  } catch (error) {
    if (error instanceof UploadError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('POST /api/upload', error);
    return NextResponse.json({ error: '上传失败，请稍后重试。' }, { status: 500 });
  }
}
