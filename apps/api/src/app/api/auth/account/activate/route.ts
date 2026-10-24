import {NextResponse} from 'next/server';
import {activateAccount, AccountRecoveryError} from '@rumiai/backend/modules/accounts/account-recovery-service';
import {privateHeaders} from '@rumiai/backend/infrastructure/http';

export async function POST(request: Request) {
  try { const body = await request.json().catch(() => null) as {token?: unknown; password?: unknown} | null; await activateAccount(body?.token, body?.password); return NextResponse.json({activated: true}, {headers: privateHeaders}); }
  catch (error) { return NextResponse.json({error: error instanceof AccountRecoveryError ? error.message : '账号激活失败。'}, {status: error instanceof AccountRecoveryError ? error.status : 500, headers: privateHeaders}); }
}
