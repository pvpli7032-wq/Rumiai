import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {clientIp} from '@rumiai/backend/infrastructure/http/client-ip';
import {checkRateLimit} from '@rumiai/backend/infrastructure/http/rate-limit';
import {requestPasswordReset} from '@rumiai/backend/modules/accounts/account-recovery-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {accountEmailDeliveryConfigured} from '@rumiai/backend/infrastructure/email/account-email-delivery';

const MESSAGE = '如果该邮箱已注册，我们会发送一封重置邮件。';
const LIMIT = 5;
const WINDOW_MS = 15 * 60_000;

export async function POST(request: Request) {
  // Return the same configuration error for every address; never pretend an email was sent.
  if (!accountEmailDeliveryConfigured()) return NextResponse.json({error: '邮件服务尚未配置，请联系管理员。'}, {status: 503});
  const source = request.headers.get('x-real-ip')?.trim() || clientIp(request) || 'unknown';
  const body = await request.json().catch(() => null) as {email?: unknown} | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const emailBucket = createHash('sha256').update(email || 'empty').digest('hex');
  const byIp = checkRateLimit(`password-reset-ip:${source}`, LIMIT, WINDOW_MS);
  const byEmail = checkRateLimit(`password-reset-email:${emailBucket}`, LIMIT, WINDOW_MS);
  if (!byIp.allowed || !byEmail.allowed) return NextResponse.json({message: MESSAGE}, {status: 202});
  try {
    await requestPasswordReset(email);
  } catch (error) {
    // Do not turn storage/provider details into an account-existence oracle.
    logRouteError('POST /api/auth/password/forgot', error);
  }
  return NextResponse.json({message: MESSAGE}, {status: 202});
}
