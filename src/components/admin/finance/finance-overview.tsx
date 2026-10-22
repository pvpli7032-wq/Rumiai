'use client';

import {CalendarClock, Wallet} from 'lucide-react';
import type {FinanceReport} from '@/lib/payments/reconciliation-service';
import {AdminNotice, AdminPanel, AdminPlaceholder, AdminStat, AdminStatGrid} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {AiBudgetReport} from './ai-budget-report';
import {PaymentValidationMetrics} from './payment-validation-metrics';

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
        <div className="space-y-3 text-sm">
          {report.orderAnomalies.length === 0 && report.refundAnomalies.length === 0 && report.negativeBalances.length === 0 && (
            <p className="text-muted-foreground">未发现不一致记录。</p>
          )}
          {report.orderAnomalies.map(row => <p className="break-all" key={row.orderNo}>{row.orderNo} · {row.status} · 应入账 {row.expectedCoins} / 实际 {row.actualCoins ?? '无流水'}</p>)}
          {report.refundAnomalies.map(row => <p className="break-all" key={row.refundNo || row.orderNo}>{row.orderNo} · 退款单 {row.refundNo ?? '缺记录'} · {row.refundStatus ?? '无状态'} · 扣币 {row.debitCoins ?? '无流水'} / 返还 {row.releaseCoins ?? '无流水'}</p>)}
          {report.negativeBalances.map(row => <p className="break-all" key={row.id}>账号 {row.id} · 余额 {row.coins}</p>)}
        </div>
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
