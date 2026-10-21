'use client';

import {AlertCircle, Coins, RefreshCw} from 'lucide-react';
import Link from 'next/link';
import type {QuotaView} from '@/lib/hooks/use-quota';

/**
 * 输入区上方的常驻额度行（V3 表 15）：每条多少币、余额、今日免费剩余、额度重置时刻。
 *
 * 数值全部来自 GET /api/me/quota，页面不自己算价；收费关闭时币价为 0，这里显示「免费」
 * 而不是「0 币」。读取失败时只说读不到并给重试，不猜一个数字出来。
 */
export interface QuotaBarProps {
  quota: QuotaView | null;
  loading: boolean;
  error: string;
  /** 服务端返回余额不足（402）时高亮余额并给充值入口。 */
  insufficient: boolean;
  onRetry: () => void;
}

function formatReset(resetAt: string): string {
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false});
}

function Dot() {
  return <span aria-hidden className="text-zinc-600">·</span>;
}

export function QuotaBar({quota, loading, error, insufficient, onRetry}: QuotaBarProps) {
  if (!quota && loading) {
    return (
      <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 text-xs text-zinc-500" role="status">
        <span className="h-3 w-24 animate-pulse rounded bg-zinc-700" />
        正在读取额度…
      </div>
    );
  }

  if (!quota) {
    return (
      <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-2 text-xs text-amber-300/90" role="alert">
        <AlertCircle aria-hidden className="h-3.5 w-3.5" />
        <span>{error || '额度信息暂时读不到。'}</span>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <RefreshCw aria-hidden className="h-3 w-3" />
          重试
        </button>
      </div>
    );
  }

  const free = quota.coinsPerReply === 0;
  const shortOfCoins = quota.coinsPerReply > 0 && quota.freeRemaining === 0 && quota.balance < quota.coinsPerReply;
  const warnBalance = insufficient || shortOfCoins;

  return (
    <div className="mx-auto mb-2 max-w-3xl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1 text-zinc-300">
          <Coins aria-hidden className="h-3.5 w-3.5" />
          每条
          <strong className={free ? 'text-emerald-300' : 'text-white'}>
            {free ? '免费' : `${quota.coinsPerReply} 币`}
          </strong>
        </span>
        <Dot />
        <span>
          余额
          <strong className={warnBalance ? 'text-red-300' : 'text-white'}>{quota.balance} 币</strong>
        </span>
        <Dot />
        <span>
          {quota.freeDaily > 0 ? `今日免费剩余 ${quota.freeRemaining} 条` : '今日无免费次数'}
        </span>
        <Dot />
        <span className="text-zinc-500">额度将于 {formatReset(quota.resetAt)} 重置</span>
        {warnBalance && (
          <Link
            href="/shop"
            className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-200 transition-colors hover:bg-amber-400/20"
          >
            去充值
          </Link>
        )}
      </div>
    </div>
  );
}
