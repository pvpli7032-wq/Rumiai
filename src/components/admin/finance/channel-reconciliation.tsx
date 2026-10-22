'use client';

import { Download, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminNotice, AdminPanel, AdminToolbar } from '@/components/admin/admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { formatCny } from '@/lib/format/number';

type Batch = { id: string; provider: string; importedById: string; importReason: string; rowCount: number; matchedRowCount: number; exceptionRowCount: number; grossCnyCents: number; feeCnyCents: number; netCnyCents: number; periodStart: string; periodEnd: string; createdAt: string; duplicate?: boolean };
type Entry = { entrySource: string; lineNumber: number | null; providerTradeNo: string | null; orderNo: string; grossCnyCents: number | null; feeCnyCents: number | null; netCnyCents: number | null; paidAt: string; matchStatus: string; matchLabel: string; exceptionCode: string | null; internalAmountCnyCents: number | null; internalOrderStatus: string | null };
type Detail = { batch: Batch; page: number; pageSize: number; total: number; entries: Entry[] };

export function ChannelReconciliation({ token, canImport }: { token: string; canImport: boolean }) {
  const [batches, setBatches] = useState<Batch[]>([]), [selected, setSelected] = useState(''), [detail, setDetail] = useState<Detail | null>(null), [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null), [reason, setReason] = useState(''), [periodStart, setPeriodStart] = useState(''), [periodEnd, setPeriodEnd] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const loadBatches = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/finance/reconciliation', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setBatches(data.batches); setSelected(current => current || data.batches[0]?.id || '');
    } catch (e) { setError(e instanceof Error ? e.message : '对账批次读取失败。'); }
  }, [token]);
  const loadDetail = useCallback(async (id: string, currentPage: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/finance/reconciliation/${encodeURIComponent(id)}?page=${currentPage}&pageSize=25`, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setDetail(data);
    } catch (e) { setDetail(null); setError(e instanceof Error ? e.message : '对账明细读取失败。'); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void loadBatches(); }, [loadBatches]);
  useEffect(() => { if (selected) void loadDetail(selected, page); else setDetail(null); }, [loadDetail, page, selected]);

  async function importCsv() {
    if (!file || !reason.trim() || !periodStart || !periodEnd || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const csv = await file.text();
      const response = await fetch('/api/admin/finance/reconciliation', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, reason, periodStart: new Date(periodStart).toISOString(), periodEnd: new Date(periodEnd).toISOString() }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setMessage(data.duplicate ? '该文件已导入，已显示原批次。' : `匹配 ${data.matchedRowCount} 笔，差异 ${data.exceptionRowCount} 笔。`);
      setSelected(data.id); setPage(1); setFile(null); setReason('');
      await loadBatches();
    } catch (e) { setError(e instanceof Error ? e.message : '对账文件导入失败。'); } finally { setBusy(false); }
  }

  function downloadTemplate() {
    const csv = 'trade_no,out_trade_no,money,fee,paid_at,status\nEZFP-TRADE-001,KH000000000000000000000000,10.00,0.30,2026-10-14T12:00:00+08:00,PAID\n';
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ezfp-reconciliation-template.csv'; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <AdminPanel title="渠道账单核对" description="导入标准化 EZFP 支付记录 CSV。仅保存校验字段与对账结果；不会更改订单、金币或退款状态。">
      <div className="space-y-5">
        {canImport && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">对账 CSV</span>
                <Input type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0] ?? null)} className="cursor-pointer py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:text-foreground" />
                <span className="block break-all text-xs text-muted-foreground">标准表头：trade_no,out_trade_no,money,fee,paid_at,status；金额单位为元，paid_at 必须带时区；status 仅接受 PAID、TRADE_SUCCESS 或 1。</span>
              </label>
              <div className="grid gap-3">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">核对开始时间</span>
                  <Input type="datetime-local" value={periodStart} onChange={event => setPeriodStart(event.target.value)} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">核对结束时间</span>
                  <Input type="datetime-local" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} />
                </label>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">导入原因</span>
              <Input maxLength={300} value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：EZFP 2026-10-14 日账单" />
            </label>
            <AdminToolbar>
              <Button variant="outline" size="sm" leadingIcon={<Download className="h-4 w-4" />} onClick={downloadTemplate}>下载模板</Button>
              <Button size="sm" leadingIcon={<Upload className="h-4 w-4" />} loading={busy} disabled={!file || !reason.trim() || !periodStart || !periodEnd} onClick={() => void importCsv()}>导入并核对</Button>
            </AdminToolbar>
          </div>
        )}
        {error && <AdminNotice tone="error" title={error} />}
        {message && <AdminNotice tone="success" title={message} />}
        <div className="space-y-3">
          <p className="text-sm font-medium">最近导入批次</p>
          {!batches.length
            ? <p className="text-sm text-muted-foreground">暂无对账批次。</p>
            : <div className="grid gap-2 md:grid-cols-2">{batches.map(batch => (
              <button key={batch.id} type="button" onClick={() => { setSelected(batch.id); setPage(1); }} className={`min-h-20 rounded-lg border p-3 text-left transition-colors ${selected === batch.id ? 'border-brand bg-brand-soft' : 'border-border hover:bg-muted'}`}>
                <span className="block break-all text-sm font-medium">{new Date(batch.createdAt).toLocaleString('zh-CN')} · {batch.rowCount} 笔</span>
                <span className="mt-1 block text-xs text-muted-foreground">匹配 {batch.matchedRowCount} · 差异 {batch.exceptionRowCount} · 手续费 {formatCny(batch.feeCnyCents)}</span>
              </button>
            ))}</div>}
        </div>
        {detail && (
          <div className="space-y-3 border-t border-border pt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">批次对账结果</p>
              <p className="text-xs text-muted-foreground">原始金额 {formatCny(detail.batch.grossCnyCents)} · 手续费 {formatCny(detail.batch.feeCnyCents)} · 估算净额 {formatCny(detail.batch.netCnyCents)}</p>
            </div>
            <p className="text-xs text-muted-foreground">导入原因：{detail.batch.importReason} · 时间范围 {new Date(detail.batch.periodStart).toLocaleString('zh-CN')} – {new Date(detail.batch.periodEnd).toLocaleString('zh-CN')}</p>
            <div className="space-y-2">{detail.entries.map((entry, index) => (
              <article key={`${entry.entrySource}-${entry.lineNumber ?? entry.orderNo}-${index}`} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="break-all font-medium">{entry.lineNumber === null ? '本地订单缺失项' : `CSV 第 ${entry.lineNumber} 行`}</p>
                  <Badge variant={entry.exceptionCode ? 'warning' : 'success'}>{entry.matchLabel}</Badge>
                </div>
                <p className="break-all text-xs text-muted-foreground">{entry.orderNo} · {entry.providerTradeNo ?? '渠道交易号缺失'}</p>
                <p className="tabular-nums">{entry.grossCnyCents === null ? '渠道账单缺失' : `${formatCny(entry.grossCnyCents)} · 手续费 ${formatCny(entry.feeCnyCents ?? 0)}`}{entry.internalAmountCnyCents !== null ? ` · 本地 ${formatCny(entry.internalAmountCnyCents)}` : ''}</p>
                {entry.exceptionCode && <p className="text-xs text-amber-600">差异码：{entry.exceptionCode}</p>}
              </article>
            ))}</div>
            <Pagination
              page={detail.page}
              pageCount={Math.max(1, Math.ceil(detail.total / detail.pageSize))}
              onPageChange={setPage}
              disabled={loading}
              summary={`共 ${detail.total} 笔 · 第 ${detail.page} 页`}
            />
          </div>
        )}
      </div>
    </AdminPanel>
  );
}
