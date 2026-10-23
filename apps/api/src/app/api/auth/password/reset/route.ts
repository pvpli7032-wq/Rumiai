import {NextResponse} from 'next/server';
import {resetPassword, AccountRecoveryError} from '@rumiai/backend/modules/accounts/account-recovery-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {token?: unknown; password?: unknown} | null;
    await resetPassword(body?.token, body?.password);
    return NextResponse.json({message: '密码已重置，请重新登录。'});
  } catch (error) {
    if (error instanceof AccountRecoveryError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('POST /api/auth/password/reset', error);
    return NextResponse.json({error: '暂时无法重置密码，请稍后重试。'}, {status: 500});
  }
}
