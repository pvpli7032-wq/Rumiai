import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {checkRateLimit} from '@rumiai/backend/infrastructure/http/rate-limit';
import {requestEmailVerification} from '@rumiai/backend/modules/accounts/account-recovery-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {accountEmailDeliveryConfigured} from '@rumiai/backend/infrastructure/email/account-email-delivery';

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  if (!accountEmailDeliveryConfigured()) return NextResponse.json({error: '邮件服务尚未配置，请联系管理员。'}, {status: 503});
  const limit = checkRateLimit(`email-verification:${user.userId}`, 5, 15 * 60_000);
  if (!limit.allowed) return NextResponse.json({message: '如果邮箱仍未验证，我们会发送一封验证邮件。'}, {status: 202});
  try { await requestEmailVerification(user.userId); }
  catch (error) { logRouteError('POST /api/auth/email/resend', error); }
  return NextResponse.json({message: '如果邮箱仍未验证，我们会发送一封验证邮件。'}, {status: 202});
}
