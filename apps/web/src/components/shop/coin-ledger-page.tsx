'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, Coins, Loader2} from 'lucide-react';
import {useAuth} from '@web/lib/auth-context';
import {loginWithNext} from '@web/lib/next-path';
import {api} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import type {CoinLedgerEntry, CoinLedgerPage} from '@rumiai/contracts/api-types/coins';

const TYPE_LABEL: Record<CoinLedgerEntry['type'], string> = {
  PURCHASE: '充值到账',
  EARNED: '金币获得',
  SPENT: '金币消耗',
};

const SOURCE_LABEL: Record<string, string> = {
  PURCHASE: '支付订单',
  CHECKIN: '每日签到',
  MISSION: '任务奖励',
  GIFT: '赠送礼物',
  GIFT_SENT: '送出礼物',
  REFUND: '退款扣回',
  REFUND_RELEASE: '退款回补',
  ADMIN: '后台调整',
};

function typeIcon(entry: CoinLedgerEntry) {
  if (entry.type === 'PURCHASE') return '🧾';
  if (entry.type === 'SPENT') return '🎁';
  return '✨';
}

/** 金币流水：余额 + 逐条进出，按游标翻页。 */
export default function CoinLedgerPage() {
  const {token, user, refreshUser} = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [items, setItems] = useState<CoinLedgerEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const loadedOnce = useRef(false);

  const load = useCallback(async (nextCursor?: string | null) => {
    if (!token) return;
    const first = !loadedOnce.current;
    if (first) setLoading(true);
    else setLoadingMore(true);
    try {
      const query = nextCursor ? `take=20&cursor=${encodeURIComponent(nextCursor)}` : 'take=20';
      const page = await api.get<CoinLedgerPage>(API.coins.ledger(query), {token});
      setBalance(page.balance);
      setItems(previous => (nextCursor ? [...previous, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError('');
      loadedOnce.current = true;
    } catch (value) {
      setError((value as Error).message || '读取金币流水失败。');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void load(null);
  }, [token, load]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="sticky top-16 z-20 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <Link href="/shop" aria-label="返回商城" className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex-1 text-base font-bold">金币流水</h1>
          <Link href="/shop" className="text-xs font-semibold text-muted-foreground hover:text-foreground">去充值</Link>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="flex items-center justify-between rounded-2xl border border-brand/30 bg-brand-soft/30 p-4">
          <div>
            <p className="text-xs text-muted-foreground">当前余额</p>
            <p className="mt-1 flex items-center gap-1.5 text-2xl font-bold text-brand">
              <Coins className="h-5 w-5" />
              {(balance ?? user?.coins ?? 0).toLocaleString()}
            </p>
          </div>
          <button onClick={() => void refreshUser()} className="rounded-lg border border-brand/30 px-3 py-2 text-xs font-semibold text-brand hover:bg-brand-soft/30">
            刷新余额
          </button>
        </div>

        {!token ? (
          <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
            登录后可以查看自己的金币流水。<Link href={loginWithNext()} className="ml-1 underline underline-offset-4">去登录</Link>
          </p>
        ) : loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
        ) : error ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-red-500">{error}</p>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">还没有金币记录。签到、完成任务或充值后会出现在这里。</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {items.map(entry => {
              const positive = entry.amount >= 0;
              return (
                <li key={entry.id} className="flex items-center gap-3 p-4">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-base">{typeIcon(entry)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.description || TYPE_LABEL[entry.type]}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {TYPE_LABEL[entry.type]} · {SOURCE_LABEL[entry.sourceKey] ?? entry.sourceKey} · {new Date(entry.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${positive ? 'text-foreground' : 'text-destructive'}`}>
                    {positive ? '+' : ''}{entry.amount.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {token && cursor && (
          <button
            onClick={() => void load(cursor)}
            disabled={loadingMore}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-60"
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loadingMore ? '正在加载…' : '加载更多'}
          </button>
        )}
      </div>
    </div>
  );
}
