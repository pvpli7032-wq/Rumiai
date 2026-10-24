import {NextResponse} from 'next/server';
import {verifyEmail, AccountRecoveryError} from '@rumiai/backend/modules/accounts/account-recovery-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {token?: unknown} | null;
    await verifyEmail(body?.token);
    return NextResponse.json({message: '邮箱验证成功。'});
  } catch (error) {
    if (error instanceof AccountRecoveryError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('POST /api/auth/email/verify', error);
    return NextResponse.json({error: '暂时无法验证邮箱，请稍后重试。'}, {status: 500});
  }
}
