import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { checkRateLimit } from '@rumiai/backend/infrastructure/http/rate-limit';
import { readRateLimitRules } from '@rumiai/backend/modules/settings/limits';
import { saveAccountUpload, UploadError } from '@rumiai/backend/modules/uploads/storage-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 上传会落盘，限制单账号的写入速度；参数来自设置中心，每次请求现读（V3 §203）。
    const rules = await readRateLimitRules();
    const limit = checkRateLimit(`upload:${authUser.userId}`, rules.upload.perWindow, rules.upload.windowMs);
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
