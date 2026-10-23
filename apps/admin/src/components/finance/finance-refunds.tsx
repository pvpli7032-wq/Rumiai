'use client';

import {useCallback, useEffect, useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {AdminNotice, AdminPanel, AdminToolbar} from '@admin/components/admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {DataTable, type DataTableColumn} from '@admin/components/layout/data-table';
import {Input} from '@rumiai/ui/input';
import {formatCny} from '@rumiai/contracts/format/number';
import {STATUS_LABEL, type OrderRow} from './order-types';

/**
 * 退款台账（V3 表 14：退款是独立标签，但处理动作在订单详情里）。
 *
 * 这里只做「哪些订单有退款、处在什么状态、谁批的」的清点，
 * 申请／批准／驳回／重试全部在订单详情抽屉内完成，列表不放动作表单。
 */
export function FinanceRefunds({sessionActive, onOpenOrder}: {sessionActive: boolean; onOpenOrder: (orderNo: string) => void}) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/finance/orders', {credentials: 'include', cache: 'no-store', signal});
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      if (!signal?.aborted) setRows((data as OrderRow[]).filter(row => row.refund));
    } catch (loadError) {
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : '退款记录加载失败。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [sessionActive]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const needle = keyword.trim().toLowerCase();
  const visible = needle
    ? rows.filter(row => row.orderNo.toLowerCase().includes(needle) || (row.refund?.refundNo ?? '').toLowerCase().includes(needle))
    : rows;

  const columns: DataTableColumn<OrderRow>[] = [
    {id: 'refundNo', header: '退款单号', width: '200px', cell: order => (
      <div className="min-w-0">
      <p className="break-all font-medium">{order.refund!.membershipRefundId ? `会员记录 ${order.refund!.membershipRefundId}` : order.refund!.refundNo ?? '退款记录'}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">订单 {order.orderNo}</p>
      </div>
    )},
    {id: 'status', header: '退款状态', width: '120px', cell: order => (
      <Badge variant={order.refund!.status === 'SUCCEEDED' ? 'success' : order.refund!.status === 'FAILED' ? 'danger' : 'warning'}>
        {STATUS_LABEL[order.refund!.status] ?? order.refund!.status}
      </Badge>
    )},
    {id: 'amount', header: '金额与金币', width: '180px', cell: order => (
      <div>
        <p className="whitespace-nowrap tabular-nums">{formatCny(order.refund!.amountCnyCents ?? order.amountCnyCents)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{order.refund!.coinAmount ?? order.coinAmount} 枚金币</p>
      </div>
    )},
    {id: 'orderStatus', header: '订单状态', width: '130px', cell: order => STATUS_LABEL[order.status] ?? order.status},
    {id: 'code', header: '核对码', width: '160px', cell: order => order.refund!.errorCode
      ? <span className="break-all text-xs">{order.refund!.errorCode}</span>
      : <span className="text-xs text-muted-foreground">无</span>},
    {id: 'time', header: '完成时间', width: '180px', cell: order => order.refund!.completedAt
      ? <span className="whitespace-nowrap text-xs">{new Date(order.refund!.completedAt).toLocaleString('zh-CN')}</span>
      : <span className="text-xs text-muted-foreground">未完成</span>},
    {id: 'actions', header: '操作', align: 'right' as const, width: '150px', cell: order => (
      <Button variant="outline" size="sm" leadingIcon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => onOpenOrder(order.orderNo)}>在订单详情处理</Button>
    )},
  ];

  return (
    <AdminPanel title="退款台账" description="退款申请、审批与重试都在订单详情里执行：申请时暂扣金币，另一位管理员批准后才联系渠道，渠道明确拒绝会返还。">
      <div className="space-y-4">
        <AdminToolbar>
          <label className="min-w-64 flex-1 space-y-1">
            <span className="text-xs font-medium text-muted-foreground">按退款单号或订单号筛选</span>
            <Input maxLength={80} value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="退款单号或订单号" />
          </label>
        </AdminToolbar>
        {error && <AdminNotice tone="error" title={error} />}
        <DataTable
          columns={columns}
          rows={visible}
          getRowId={order => order.orderNo}
          loading={loading}
          loadingRows={5}
          empty={needle ? '没有匹配的退款记录。' : '还没有退款记录。'}
        />
      </div>
    </AdminPanel>
  );
}
