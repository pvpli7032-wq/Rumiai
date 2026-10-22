'use client';

import {useCallback, useEffect, useState} from 'react';
import {AdminNotice, AdminPlaceholder} from '@/components/admin/admin-page';
import {DetailDrawer, DetailRow, DetailSection} from '@/components/admin/layout/detail-drawer';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {Textarea} from '@/components/ui/textarea';
import {formatCny} from '@/lib/format/number';
import {STATUS_LABEL, type OrderRow, type RefundDetail} from './order-types';

/**
 * 订单详情抽屉：订单概况、退款记录、验签回调时间线，退款处理就在这一处（V3 表 14）。
 *
 * 列表只保留可扫读的列，时间线与退款动作都收进来；退款全貌比列表多审批链，
 * 打开时按订单号再取一次退款服务返回的完整记录。
 */
type Action = 'request' | 'approve' | 'reject' | 'retry' | 'verify';

const CONFIRM: Partial<Record<Action, (order: OrderRow) => string>> = {
  request: order => `申请整单退款 ${formatCny(order.amountCnyCents)}，将暂扣账号余额中的 ${order.coinAmount} 枚金币，等待另一位管理员审批。`,
  approve: order => `批准退款 ${formatCny(order.amountCnyCents)} 并提交到支付渠道？`,
  reject: () => '驳回退款申请并释放已暂扣金币？',
};

export function OrderDetailDrawer({order, token, canRequest, canApprove, canExecute, onClose, onChanged}: {
  order: OrderRow | null;
  token: string;
  canRequest: boolean;
  canApprove: boolean;
  canExecute: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [refund, setRefund] = useState<RefundDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Action | null>(null);
  const orderNo = order?.orderNo ?? '';

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!orderNo) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/finance/orders?orderNo=${encodeURIComponent(orderNo)}`, {headers: {Authorization: 'Bearer ' + token}, cache: 'no-store', signal});
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      if (!signal?.aborted) setRefund((data as Array<{refund: RefundDetail | null}>)[0]?.refund ?? null);
    } catch (loadError) {
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : '退款记录读取失败。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [orderNo, token]);

  useEffect(() => {
    const controller = new AbortController();
    setRefund(null); setError(''); setMessage(''); setReason('');
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function act(action: Action) {
    setPending(null);
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/admin/finance/orders/${encodeURIComponent(orderNo)}/refund`, {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
        body: JSON.stringify({action, reason: reason.trim() || (action === 'retry' ? '按原退款单号重试' : '')}),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage(`${orderNo}：${STATUS_LABEL[data.status] ?? data.status}${data.errorCode ? `（${data.errorCode}）` : ''}`);
      } else {
        setError(data.error ?? '退款操作失败。');
      }
      // 退款服务把「渠道结果未能确认」也报成 502（refund-service.ts 的 callProvider 先写 UNKNOWN 再抛错），
      // 但记录已经落到 UNKNOWN —— 那是真实的状态推进，不是请求失败。所以成败都要读回最新状态，
      // 否则详情会一直停在「待审批」，查单与重试按钮永远不出现。
      setReason('');
      await load();
      onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '退款操作失败。');
    } finally {
      setBusy(false);
    }
  }

  /** 申请/批准/驳回要理由也要二次确认；查单与重试只读回渠道结果，不写业务数据，直接执行。 */
  function start(action: Action) {
    if (busy) return;
    const text = CONFIRM[action];
    if (text && order) {
      if (!reason.trim()) return;
      setPending(action);
    } else {
      void act(action);
    }
  }

  const waitingApproval = refund?.status === 'PENDING_APPROVAL' && !refund.requestedByMe;
  const needsFollowUp = refund !== null && ['UNKNOWN', 'PROCESSING'].includes(refund.status);

  return (
    <>
      <DetailDrawer
        open={Boolean(order)}
        onClose={onClose}
        title={order ? `订单 ${order.orderNo}` : '订单详情'}
        description="退款在这里处理：申请时暂扣金币，另一位管理员批准后才联系渠道；渠道明确拒绝会返还。"
        footer={<Button variant="outline" onClick={onClose}>关闭</Button>}
      >
        {order && (
          <>
            <DetailSection title="订单概况">
              <DetailRow label="状态">{STATUS_LABEL[order.status] ?? order.status}</DetailRow>
              <DetailRow label="金额">{formatCny(order.amountCnyCents)}</DetailRow>
              <DetailRow label="金币">
                {order.coinAmount} 枚{order.packageCoins === undefined ? '' : `（基础 ${order.packageCoins} + 赠送 ${order.packageBonus ?? 0}）`}
              </DetailRow>
              <DetailRow label="支付渠道">{order.provider}</DetailRow>
              <DetailRow label="渠道单号">{order.providerTradeNo ?? '未返回'}</DetailRow>
              <DetailRow label="创建时间">{order.createdAt ? new Date(order.createdAt).toLocaleString('zh-CN') : '未返回'}</DetailRow>
              <DetailRow label="支付时间">{order.paidAt ? new Date(order.paidAt).toLocaleString('zh-CN') : '—'}</DetailRow>
            </DetailSection>

            <DetailSection title="退款记录">
              {loading && <AdminPlaceholder>正在读取退款记录…</AdminPlaceholder>}
              {!loading && !refund && <p className="text-sm text-muted-foreground">这笔订单还没有退款申请。</p>}
              {refund && (
                <>
                  <DetailRow label="退款状态"><Badge variant="warning">{STATUS_LABEL[refund.status] ?? refund.status}</Badge></DetailRow>
                  <DetailRow label="退款单号">{refund.refundNo}</DetailRow>
                  <DetailRow label="退款金额">{formatCny(refund.amountCnyCents)} · {refund.coinAmount} 枚金币</DetailRow>
                  <DetailRow label="申请理由">{refund.reason}</DetailRow>
                  <DetailRow label="申请时间">{new Date(refund.createdAt).toLocaleString('zh-CN')}</DetailRow>
                  {refund.approvedAt && <DetailRow label="审批">{refund.approvalReason || '已批准'} · {new Date(refund.approvedAt).toLocaleString('zh-CN')}</DetailRow>}
                  {refund.rejectionReason && <DetailRow label="驳回原因">{refund.rejectionReason}</DetailRow>}
                  {refund.errorCode && <DetailRow label="核对码">{refund.errorCode}</DetailRow>}
                  {refund.completedAt && <DetailRow label="完成时间">{new Date(refund.completedAt).toLocaleString('zh-CN')}</DetailRow>}
                </>
              )}
            </DetailSection>

            {(canRequest || canApprove || canExecute) && (
              <DetailSection title="处理退款" description="申请、批准、驳回与重试都要填写理由，写进审计。">
                <Textarea aria-label="申请 / 审批 / 驳回理由" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="填写 1–500 字操作理由" />
                <div className="flex flex-wrap gap-2 pt-1">
                  {canRequest && !refund && <Button size="sm" loading={busy} disabled={busy || !reason.trim()} onClick={() => start('request')}>申请整单退款</Button>}
                  {canApprove && waitingApproval && (
                    <>
                      <Button size="sm" loading={busy} disabled={busy || !reason.trim()} onClick={() => start('approve')}>批准并提交渠道</Button>
                      <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => start('reject')}>驳回申请</Button>
                    </>
                  )}
                  {canExecute && needsFollowUp && (
                    <>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => start('verify')}>查询退款状态</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => start('retry')}>同退款单号重试</Button>
                    </>
                  )}
                  {refund && !waitingApproval && !needsFollowUp && <p className="text-sm text-muted-foreground">这笔退款已结束，没有可执行的动作。</p>}
                </div>
                {error && <AdminNotice tone="error" title={error} />}
                {message && <AdminNotice tone="success" title={message} />}
              </DetailSection>
            )}

            <DetailSection title="验签回调时间线" description="按到达时间正序；重复与业务校验拒绝也照实记录。">
              {(order.callbackEvents ?? []).length === 0
                ? <p className="text-sm text-muted-foreground">暂无回调记录。</p>
                : <ol className="space-y-2">
                    {(order.callbackEvents ?? []).map((event, index) => (
                      <li key={event.receivedAt + '-' + index} className="break-all text-sm">
                        <span className="text-muted-foreground">{new Date(event.receivedAt).toLocaleString('zh-CN')}</span>
                        {' · '}{event.outcome === 'SETTLED' ? '入账' : event.outcome === 'DUPLICATE' ? '重复' : '业务校验拒绝' + (event.reasonCode ? ' · ' + event.reasonCode : '')}
                        {' · '}{event.providerTradeNo}
                      </li>
                    ))}
                  </ol>}
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="确认退款操作"
        description={pending && order ? CONFIRM[pending]?.(order) : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>取消</Button>
            <Button variant="danger" disabled={busy} onClick={() => pending && void act(pending)}>确认执行</Button>
          </>
        }
      />
    </>
  );
}
