import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {logRouteError} from '@/lib/logger';
import {privateHeaders} from '@/lib/http/errors';
import {readCoinLedger} from '@/lib/coins/ledger-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    // 余额是私有数据，401 和 500 也带上 no-store，避免中间层缓存。
    if (!auth) return NextResponse.json({error: '请先登录。', code: 'UNAUTHORIZED'}, {status: 401, headers: privateHeaders});
    const {searchParams} = new URL(request.url);
    const takeParam = Number(searchParams.get('take') ?? '20');
    const ledger = await readCoinLedger(auth.userId, {
      cursor: searchParams.get('cursor'),
      take: Number.isFinite(takeParam) ? takeParam : 20,
    });
    return NextResponse.json(ledger, {headers: privateHeaders});
  } catch (error) {
    logRouteError('GET /api/coins/ledger', error);
    return NextResponse.json({error: '读取金币流水失败。', code: 'INTERNAL'}, {status: 500, headers: privateHeaders});
  }
}
