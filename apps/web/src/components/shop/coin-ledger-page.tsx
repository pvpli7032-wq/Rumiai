'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {BackButton} from '@/components/layout/back-button';
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
  const generation = useRef(0);
  const [filters,setFilters]=useState({direction:'all',source:'',from:'',to:''});
  const [draftFilters,setDraftFilters]=useState(filters);
  const [sources,setSources]=useState<string[]>([]);

  const load = useCallback(async (nextCursor?: string | null) => {
    if (!token) return;
    const requestGeneration=generation.current;
    const first = !loadedOnce.current;
    if (first) setLoading(true);
    else setLoadingMore(true);
    try {
      const params=new URLSearchParams({take:'20',direction:filters.direction});
      for(const key of ['source','from','to'] as const)if(filters[key])params.set(key,filters[key]);
      if(nextCursor)params.set('cursor',nextCursor);
      const query=params.toString();
      const page = await api.get<CoinLedgerPage>(API.coins.ledger(query), {token});
      if(requestGeneration!==generation.current)return;
      setSources(page.availableSources??[]);
      setBalance(page.balance);
      setItems(previous => (nextCursor ? [...previous, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError('');
      loadedOnce.current = true;
    } catch (value) {
      if(requestGeneration!==generation.current)return;
      setError((value as Error).message || '读取金币流水失败。');
    } finally {
      if(requestGeneration===generation.current){setLoading(false);setLoadingMore(false);}
    }
  }, [token,filters]);

  useEffect(() => {
    generation.current++;loadedOnce.current=false;setItems([]);setCursor(null);setBalance(null);setError('');
    if (!token) {
      setLoading(false);
      return;
    }
    void load(null);
    return ()=>{generation.current++;};
  }, [token, load]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="sticky top-16 z-20 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <BackButton fallback="/shop" ariaLabel="返回上一页" className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </BackButton>
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
          <button onClick={() => {void refreshUser();void load(null);}} className="rounded-lg border border-brand/30 px-3 py-2 text-xs font-semibold text-brand hover:bg-brand-soft/30">
            刷新余额
          </button>
        </div>

        {token&&<details className="rounded-xl border border-border"><summary className="cursor-pointer px-4 py-3 text-sm">筛选流水<span className="ml-2 text-xs text-muted-foreground">收支、来源与日期</span></summary><form className="grid grid-cols-2 gap-3 border-t border-border p-4" onSubmit={event=>{event.preventDefault();setFilters({...draftFilters});}}><label className="text-xs">收支方向<select className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-2" value={draftFilters.direction} onChange={event=>setDraftFilters({...draftFilters,direction:event.target.value})}><option value="all">全部收支</option><option value="in">收入</option><option value="out">支出</option></select></label><label className="text-xs">来源<select className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-2" value={draftFilters.source} onChange={event=>setDraftFilters({...draftFilters,source:event.target.value})}><option value="">全部来源</option>{sources.map(source=><option key={source} value={source}>{SOURCE_LABEL[source]??source}</option>)}</select></label><label className="min-w-0 text-xs">开始日期<input aria-label="流水开始日期" type="date" className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-input bg-background px-2" value={draftFilters.from} onChange={event=>setDraftFilters({...draftFilters,from:event.target.value})}/></label><label className="min-w-0 text-xs">结束日期<input aria-label="流水结束日期" type="date" className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-input bg-background px-2" value={draftFilters.to} onChange={event=>setDraftFilters({...draftFilters,to:event.target.value})}/></label><p className="col-span-2 text-xs text-muted-foreground">日期范围按 UTC 计算，含结束日期全天。</p><button type="submit" className="min-h-11 rounded-xl bg-brand-strong px-3 text-sm text-white">应用筛选</button><button type="button" className="min-h-11 rounded-xl border border-border px-3 text-sm" onClick={()=>{const empty={direction:'all',source:'',from:'',to:''};setDraftFilters(empty);setFilters(empty);}}>重置</button></form></details>}
        {!token ? (
          <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
            登录后可以查看自己的金币流水。<Link href={loginWithNext()} className="ml-1 underline underline-offset-4">去登录</Link>
          </p>
        ) : loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
        ) : error ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-red-500">{error}</p>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">当前筛选没有金币记录。可以调整条件或重置后查看全部。</p>
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
                    {entry.sourceHref&&<Link href={entry.sourceHref} className="mt-1 inline-block py-1 text-xs text-brand underline underline-offset-4">{entry.sourceHref.startsWith('/chat')?'查看关联会话':'查看资产入口'}</Link>}
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
