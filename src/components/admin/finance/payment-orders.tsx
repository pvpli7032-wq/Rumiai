'use client';

import { Download, Eye, Search } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AdminNotice, AdminPanel, AdminToolbar } from '@/components/admin/admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { OrderDetailDrawer } from './order-detail-drawer';
import { STATUS_LABEL, type OrderRow } from './order-types';

type OrderPage = { page: number; pageSize: number; total: number; items: OrderRow[] };

const STATUS_FILTERS = [
  { value: 'ALL', label: '全部状态' },
  { value: 'PENDING', label: '待支付' },
  { value: 'PAID', label: '已支付' },
  { value: 'REFUND_PENDING', label: '退款处理中' },
  { value: 'REFUNDED', label: '已退款' },
  { value: 'FAILED', label: '支付失败' },
];

function money(order: OrderRow) {
  if (order.currency === 'CNY') return '¥' + (order.amountCnyCents / 100).toFixed(2);
  return order.currency + ' ' + (order.amountCnyCents / 100).toFixed(2);
}

/**
 * 充值订单列表（V3 表 14：订单为默认页）。
 *
 * 列表只留可扫读的列；验签回调时间线与退款处理都在订单详情抽屉里，
 * 列表本身不再放退款表单。
 */
export function PaymentOrderManagement({ token, canRequest, canApprove, canExecute, focusOrderNo, onFocusHandled }: {
  token: string;
  canRequest: boolean;
  canApprove: boolean;
  canExecute: boolean;
  /** 从退款台账跳过来时要直接打开的订单号；打开后由调用方清空。 */
  focusOrderNo?: string;
  onFocusHandled?: () => void;
}) {
  const [result, setResult] = useState<OrderPage | null>(null);
  const [status, setStatus] = useState('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  /**
   * 下单日期区间（UTC 日，含结束当天）。null 表示还没读到 URL —— 此时不发请求，
   * 避免先按「无日期」查一次再从 URL 带日期重查。
   * 用 window.location 而不是 useSearchParams，理由同 account-management.tsx。
   */
  const [created, setCreated] = useState<{from: string; until: string} | null>(null);
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCreated({from: params.get('from') ?? '', until: params.get('until') ?? ''});
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!created) return;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25', status });
      if (query.trim()) params.set('q', query.trim());
      if (created.from) params.set('from', created.from);
      if (created.until) params.set('until', created.until);
      const response = await fetch('/api/admin/finance/orders/all?' + params, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setResult(data);
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : '订单列表加载失败。');
        setResult(null);
      }
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, [page, query, status, token, created]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /** 退款台账点「在订单详情处理」后，按订单号取一次完整行并直接打开抽屉。 */
  useEffect(() => {
    if (!focusOrderNo) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/admin/finance/orders?orderNo=' + encodeURIComponent(focusOrderNo), { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        const found = (data as OrderRow[])[0];
        if (!active) return;
        if (found) setSelected(found); else setError('这笔订单不在可退款范围内。');
      } catch (focusError) {
        if (active) setError(focusError instanceof Error ? focusError.message : '订单详情加载失败。');
      } finally {
        if (active) onFocusHandled?.();
      }
    })();
    return () => { active = false; };
  }, [focusOrderNo, token, onFocusHandled]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (page !== 1) setPage(1);
    else void load();
  }

  function changeStatus(value: string) {
    setPage(1);
    setStatus(value);
  }

  async function exportCsv() {
    setExporting(true); setError('');
    try {
      const params = new URLSearchParams({ status });
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch('/api/admin/finance/orders/export?' + params, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (!response.ok) { const data = await response.json(); throw Error(data.error); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'payment-orders.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : '订单导出失败。'); }
    finally { setExporting(false); }
  }

  const columns: DataTableColumn<OrderRow>[] = [
    { id: 'order', header: '订单', width: '260px', cell: order => (
      <div className="min-w-0">
        <p className="break-all font-medium">{order.orderNo}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">渠道单号：{order.providerTradeNo ?? '未返回'}</p>
      </div>
    ) },
    { id: 'status', header: '状态', width: '120px', cell: order => (
      <Badge variant={order.status === 'PAID' ? 'success' : ['REFUNDED', 'REFUND_PENDING', 'FAILED', 'UNKNOWN'].includes(order.status) ? 'warning' : 'neutral'}>
        {STATUS_LABEL[order.status] ?? order.status}
      </Badge>
    ) },
    { id: 'amount', header: '金额与金币', width: '200px', cell: order => (
      <div>
        <p className="whitespace-nowrap tabular-nums">{money(order)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{order.coinAmount} 枚（基础 {order.packageCoins} + 赠送 {order.packageBonus}）</p>
      </div>
    ) },
    { id: 'provider', header: '支付渠道', width: '120px', cell: order => order.provider },
    { id: 'refund', header: '退款', width: '220px', cell: order => order.refund
      ? <span className="break-all text-xs">{(STATUS_LABEL[order.refund.status] ?? order.refund.status)} · {order.refund.refundNo}{order.refund.errorCode ? ' · ' + order.refund.errorCode : ''}</span>
      : <span className="text-xs text-muted-foreground">无</span> },
    { id: 'time', header: '时间', width: '200px', cell: order => (
      <div className="whitespace-nowrap">
        <p className="text-xs">创建 {order.createdAt ? new Date(order.createdAt).toLocaleString('zh-CN') : '未返回'}</p>
        <p className="mt-1 text-xs text-muted-foreground">支付 {order.paidAt ? new Date(order.paidAt).toLocaleString('zh-CN') : '—'}</p>
      </div>
    ) },
    { id: 'actions', header: '操作', align: 'right' as const, width: '110px', cell: order => (
      <Button variant="outline" size="sm" leadingIcon={<Eye className="h-3.5 w-3.5" />} aria-label={`查看订单 ${order.orderNo}`} onClick={() => setSelected(order)}>详情</Button>
    ) },
  ];

  const pageSize = result?.pageSize ?? 25;
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / pageSize));

  return (
    <>
      <AdminPanel title="充值订单" description="只读订单快照与退款状态；时间线与退款处理在订单详情里。日期按下单时间筛，UTC 日边界并包含截止日当天。">
        <div className="space-y-4">
          <form onSubmit={search}>
            <AdminToolbar>
              <label className="min-w-64 flex-1 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">按订单号或渠道单号查找</span>
                <Input maxLength={80} value={query} onChange={event => setQuery(event.target.value)} />
              </label>
              <label className="w-40 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">订单状态</span>
                <Select aria-label="订单状态" value={status} onChange={event => changeStatus(event.target.value)}>
                  {STATUS_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </label>
              <label className="w-40 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">下单起始日（UTC）</span>
                <Input type="date" aria-label="下单起始日" max={created?.until || undefined} value={created?.from ?? ''} onChange={event => {setCreated(current => ({from: event.target.value, until: current?.until ?? ''})); setPage(1);}} />
              </label>
              <label className="w-40 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">下单截止日（UTC）</span>
                <Input type="date" aria-label="下单截止日" min={created?.from || undefined} value={created?.until ?? ''} onChange={event => {setCreated(current => ({from: current?.from ?? '', until: event.target.value})); setPage(1);}} />
              </label>
              <Button type="submit" size="sm" variant="outline" leadingIcon={<Search className="h-4 w-4" />} disabled={busy}>查询</Button>
              <Button type="button" size="sm" variant="outline" leadingIcon={<Download className="h-4 w-4" />} loading={exporting} onClick={() => void exportCsv()}>{exporting ? '正在导出…' : '导出 CSV（最多 5000 笔）'}</Button>
            </AdminToolbar>
          </form>
          {error && <AdminNotice tone="error" title={error} />}
          <DataTable
            columns={columns}
            rows={result?.items ?? []}
            getRowId={order => order.orderNo}
            loading={busy && !result}
            loadingRows={6}
            empty={focusOrderNo ? '暂无可退款订单。' : '没有匹配的充值订单。'}
            pagination={result && result.total > 0 ? {
              page: result.page,
              pageCount: pages,
              onPageChange: setPage,
              summary: `共 ${result.total} 笔 · 第 ${result.page} / ${pages} 页`,
            } : undefined}
          />
        </div>
      </AdminPanel>

      <OrderDetailDrawer
        order={selected}
        token={token}
        canRequest={canRequest}
        canApprove={canApprove}
        canExecute={canExecute}
        onClose={() => setSelected(null)}
        onChanged={() => void load()}
      />
    </>
  );
}
