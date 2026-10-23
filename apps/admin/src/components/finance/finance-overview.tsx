'use client';

import {CalendarClock, Wallet} from 'lucide-react';
import type {FinanceReport} from '@rumiai/contracts/admin/finance';
import {AdminNotice, AdminPanel, AdminPlaceholder, AdminStat, AdminStatGrid} from '@admin/components/admin-page';
import {Badge} from '@rumiai/ui/badge';
import {AiBudgetReport} from './ai-budget-report';
import {PaymentValidationMetrics} from './payment-validation-metrics';
import {DataTable} from '../layout/data-table';

/** 分转元，统一保留两位小数。 */
function yuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

/**
 * 订单标签顶部的经营概览：四张统计卡、AI 预算与支付校验、全量账本异常、AI 成本估算。
 *
 * 这些是订单页的只读汇总，不承载任何编辑动作；套餐表单已搬到「套餐」标签（V3 表 14）。
 */
export function FinanceOverview({report, loading, error}: {report: FinanceReport | null; loading: boolean; error: string}) {
  if (error) return <AdminNotice tone="error" title={error} />;
  if (loading) return <AdminNotice tone="loading" title="正在核对订单与流水…" />;
  if (!report) return null;

  return (
    <>
      <AdminStatGrid>
        <AdminStat label="已付款订单" value={`${report.paidOrders} 笔`} hint={yuan(report.paidAmountCnyCents)} icon={<Wallet className="h-4 w-4" />} tone="brand" />
        <AdminStat label="已完成退款" value={`${report.completedRefunds} 笔`} hint={yuan(report.refundedAmountCnyCents)} tone="warning" />
        <AdminStat label="退款后金额" value={yuan(report.netAfterRefundsCnyCents)} hint="不含通道手续费、结算费用与 AI 成本" tone="success" />
        <AdminStat label="报告时间" value={new Date(report.generatedAt).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})} hint={new Date(report.generatedAt).toLocaleDateString('zh-CN')} icon={<CalendarClock className="h-4 w-4" />} />
      </AdminStatGrid>

      <div className="grid gap-5 xl:grid-cols-2">
        <AiBudgetReport report={report.aiBudget} />
        <PaymentValidationMetrics metrics={report.validationMetrics} costs={report.aiCosts} />
      </div>

      <AdminPanel
        title="全量账本异常"
        description="历史期初余额尚未登记，暂不按流水合计推断余额。异常列表最多显示 100 条。"
        badge={
          <Badge variant={report.orderAnomalies.length + report.refundAnomalies.length + report.negativeBalances.length > 0 ? 'danger' : 'success'}>
            订单 {report.orderAnomalies.length}{report.orderAnomaliesTruncated ? '+' : ''} · 退款 {report.refundAnomalies.length}{report.refundAnomaliesTruncated ? '+' : ''} · 负余额 {report.negativeBalances.length}{report.negativeBalancesTruncated ? '+' : ''}
          </Badge>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <AdminStat label="订单异常" value={`${report.orderAnomalies.length}${report.orderAnomaliesTruncated ? '+' : ''}`} tone={report.orderAnomalies.length ? 'danger' : 'default'} />
          <AdminStat label="退款异常" value={`${report.refundAnomalies.length}${report.refundAnomaliesTruncated ? '+' : ''}`} tone={report.refundAnomalies.length ? 'warning' : 'default'} />
          <AdminStat label="负余额账号" value={`${report.negativeBalances.length}${report.negativeBalancesTruncated ? '+' : ''}`} />
        </div>
        {report.orderAnomalies.length + report.refundAnomalies.length + report.negativeBalances.length === 0 && <p className="mt-4 text-sm text-muted-foreground">未发现不一致记录。</p>}
        {report.orderAnomalies.length > 0 && <details className="mt-4 rounded-lg border border-border p-3" open><summary className="text-sm font-medium">订单异常明细（{report.orderAnomalies.length}）</summary><div className="mt-3"><DataTable rows={report.orderAnomalies} getRowId={row => row.orderNo} columns={[
          {id: 'order', header: '订单编号', cell: row => row.orderNo}, {id: 'status', header: '状态', cell: row => row.status}, {id: 'expected', header: '应入账金币', align: 'right', cell: row => row.expectedCoins}, {id: 'actual', header: '实际金币', align: 'right', cell: row => row.actualCoins ?? '无流水'},
        ]} /></div></details>}
        {report.refundAnomalies.length > 0 && <details className="mt-4 rounded-lg border border-border p-3"><summary className="text-sm font-medium">退款异常明细（{report.refundAnomalies.length}）</summary><div className="mt-3"><DataTable rows={report.refundAnomalies} getRowId={row => row.refundNo || row.orderNo} columns={[
          {id: 'order', header: '订单编号', cell: row => row.orderNo}, {id: 'refund', header: '退款单', cell: row => row.refundNo ?? '缺记录'}, {id: 'status', header: '状态', cell: row => row.refundStatus ?? '无状态'}, {id: 'debit', header: '扣币', align: 'right', cell: row => row.debitCoins ?? '无流水'}, {id: 'release', header: '返还', align: 'right', cell: row => row.releaseCoins ?? '无流水'},
        ]} /></div></details>}
        {report.negativeBalances.length > 0 && <details className="mt-4 rounded-lg border border-border p-3"><summary className="text-sm font-medium">负余额账号明细（{report.negativeBalances.length}）</summary><div className="mt-3"><DataTable rows={report.negativeBalances} getRowId={row => row.id} columns={[
          {id: 'account', header: '账号编号', cell: row => row.id}, {id: 'coins', header: '金币余额', align: 'right', cell: row => <span className="text-destructive">{row.coins}</span>},
        ]} /></div></details>}
      </AdminPanel>

      <AdminPanel title="AI 成本估算" description="各币种分别统计，未知成本不能视为零；模拟调用不计真实成本。这不是供应商账单。" badge={<Badge>{report.aiCosts.length} 种币种</Badge>}>
        {report.aiCosts.length === 0 ? (
          <AdminPlaceholder>此时间范围暂无调用记录。</AdminPlaceholder>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {report.aiCosts.map(row => (
              <div key={row.currency} className="break-words rounded-lg border border-border p-4">
                <p className="text-sm font-medium text-foreground">{row.currency} · 已知成本 {row.estimatedCost.toFixed(6)}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">共 {row.calls} 次；有成本记录 {row.knownCostCalls} 次，未知成本 {row.unknownCostCalls} 次，模拟 {row.mockCalls} 次，失败或取消 {row.failedCalls} 次</p>
              </div>
            ))}
          </div>
        )}
      </AdminPanel>
    </>
  );
}
