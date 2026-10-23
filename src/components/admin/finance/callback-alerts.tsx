'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminNotice, AdminPanel } from '@/components/admin/admin-page';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

type Reason = { reasonCode: string; label: string; sampledMinutes: number; firstSeenAt: string; lastSeenAt: string };
type Summary = { hours: number; generatedAt: string; since: string; retentionDays: number; sampling: string; sampledMinutes: number; reasons: Reason[] };

export function CallbackAlerts({ sessionActive }: { sessionActive: boolean }) {
  const [hours, setHours] = useState(24), [summary, setSummary] = useState<Summary | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const load = useCallback(async (range: number) => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/admin/finance/callback-alerts?hours=${range}`, {credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setSummary(data);
    } catch (e) { setError(e instanceof Error ? e.message : '支付回调告警读取失败。'); } finally { setLoading(false); }
  }, [sessionActive]);
  useEffect(() => { void load(hours); }, [hours, load]);

  return (
    <AdminPanel
      aria-label="支付回调异常（聚合）"
      title="支付回调异常（聚合）"
      description="仅记录异常类型与采样时间，不保存通知内容、订单号或交易号；保留 30 天。"
      actions={
        <>
          <Select size="sm" aria-label="回调告警时间范围" className="w-32" value={hours} disabled={loading} onChange={event => setHours(Number(event.target.value))}>
            <option value={24}>近 24 小时</option>
            <option value={168}>近 7 天</option>
          </Select>
          <Button variant="outline" size="sm" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loading} onClick={() => void load(hours)}>刷新</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <AdminNotice tone="error" title={error} />}
        {loading && !summary && <AdminNotice tone="loading" title="正在读取回调告警…" />}
        {summary && (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              近 {summary.hours === 24 ? '24 小时' : '7 天'}记录到 <span className="font-semibold tabular-nums text-foreground">{summary.sampledMinutes}</span> 个异常采样分钟。
            </p>
            {summary.reasons.length ? (
              <div className="divide-y divide-border rounded-lg border border-border">
                {summary.reasons.map(row => (
                  <div key={row.reasonCode} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="font-medium">{row.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.sampledMinutes} 分钟 · 最近 {new Date(row.lastSeenAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">此范围内未观察到回调拒绝。</p>
            )}
            <p className="text-xs text-muted-foreground">{summary.sampling}</p>
          </>
        )}
      </div>
    </AdminPanel>
  );
}
