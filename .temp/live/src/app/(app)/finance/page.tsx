'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { FinanceReport } from '@/lib/payments/reconciliation-service';
import { FinanceRefunds } from '@/components/admin/finance/finance-refunds';
import { AiBudgetReport } from '@/components/admin/finance/ai-budget-report';
import { PaymentValidationMetrics } from '@/components/admin/finance/payment-validation-metrics';
import { FinancePackages } from '@/components/admin/finance/finance-packages';
import {PaymentOrderManagement} from '@/components/admin/finance/payment-orders';
import {CallbackAlerts} from '@/components/admin/finance/callback-alerts';
import {ChannelReconciliation} from '@/components/admin/finance/channel-reconciliation';
import {useAdminAccess} from '@/components/admin/use-admin-access';

export default function FinancePage() {
  const { token, isLoading } = useAuth();
  const {permissions} = useAdminAccess();
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setError(''); setLoading(false);
    if (!token) { if (!isLoading) setError('请先登录财务管理员账号。'); return; }
    setLoading(true);
    fetch(`/api/finance/report?days=${days}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => setReport(data))
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, isLoading, days, refresh]);
  return <main className="mx-auto max-w-3xl space-y-4 p-4">
    <h1 className="text-2xl font-bold tracking-tight md:text-3xl">财务对账与 AI 成本</h1>
    <p className="text-sm text-muted-foreground">本地订单与金币流水核对。支付渠道账单与真实退款需另行核验。</p>
    <div className="flex flex-wrap gap-3"><label>统计范围 <select className="min-h-11 rounded-sm border bg-background px-2" value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 7, 30, 90].map(n => <option key={n} value={n}>近 {n} 天</option>)}</select></label><button className="min-h-11 rounded-sm border px-4" disabled={!token || loading} onClick={() => setRefresh(n => n + 1)}>刷新</button></div>
    {error && <p role="alert" className="text-red-400">{error}</p>}{loading && <p role="status">正在核对…</p>}
    {report && <>
      <FinancePackages token={token!} canEdit={permissions.includes('finance.packages.write')} />
      <div className="grid min-w-0 gap-4 xl:grid-cols-2"><div className="min-w-0"><AiBudgetReport report={report.aiBudget} /></div>
      <div className="min-w-0"><PaymentValidationMetrics metrics={report.validationMetrics} costs={report.aiCosts} /></div></div>
      <section className="space-y-2 rounded-xl border p-4"><h2 className="font-bold">本地订单金额</h2><p>已付款 {report.paidOrders} 笔 · ¥{(report.paidAmountCnyCents / 100).toFixed(2)}</p><p>已完成退款 {report.completedRefunds} 笔 · ¥{(report.refundedAmountCnyCents / 100).toFixed(2)}</p><p>退款后金额 ¥{(report.netAfterRefundsCnyCents / 100).toFixed(2)}</p><p className="text-sm text-muted-foreground">退款后金额不含通道手续费、结算费用和 AI 成本，也未与渠道账单核实。</p></section>
      <section className="space-y-2 rounded-xl border p-4"><h2 className="font-bold">全量账本异常</h2><p>充值订单流水不一致：{report.orderAnomalies.length}{report.orderAnomaliesTruncated ? '+' : ''} 笔；退款不一致：{report.refundAnomalies.length}{report.refundAnomaliesTruncated ? '+' : ''} 笔；负余额：{report.negativeBalances.length}{report.negativeBalancesTruncated ? '+' : ''} 个账号</p>{report.orderAnomalies.map(row => <p className="break-all text-sm" key={row.orderNo}>{row.orderNo} · {row.status} · 应入账 {row.expectedCoins} / 实际 {row.actualCoins ?? '无流水'}</p>)}{report.refundAnomalies.map(row => <p className="break-all text-sm" key={row.refundNo || row.orderNo}>{row.orderNo} · 退款单 {row.refundNo ?? '缺记录'} · {row.refundStatus ?? '无状态'} · 扣币 {row.debitCoins ?? '无流水'} / 返还 {row.releaseCoins ?? '无流水'}</p>)}{report.negativeBalances.map(row => <p className="break-all text-sm" key={row.id}>账号 {row.id} · 余额 {row.coins}</p>)}<p className="text-sm text-muted-foreground">历史期初余额尚未登记，暂不按流水合计推断余额。异常列表最多显示 100 条。</p></section>
      <section className="space-y-3 rounded-xl border p-4"><h2 className="font-bold">AI 成本估算</h2>{!report.aiCosts.length && <p>此时间范围暂无调用记录。</p>}{report.aiCosts.map(row => <div key={row.currency} className="break-words"><p>{row.currency} · 已知成本 {row.estimatedCost.toFixed(6)}</p><p className="text-sm">共 {row.calls} 次；有成本记录 {row.knownCostCalls} 次，未知成本 {row.unknownCostCalls} 次，模拟 {row.mockCalls} 次，失败或取消 {row.failedCalls} 次</p></div>)}<p className="text-sm text-muted-foreground">各币种分别统计，未知成本不能视为零；模拟调用不计真实成本。这不是供应商账单。</p></section>
      <p className="text-xs text-muted-foreground">报告时间：{new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
    </>}
    {token&&permissions.includes('finance.read')&&<PaymentOrderManagement token={token}/>}
    {token&&permissions.includes('finance.read')&&<CallbackAlerts token={token}/>}
    {token&&permissions.includes('finance.read')&&<ChannelReconciliation token={token} canImport={permissions.includes('finance.reconciliation.import')}/>}
    {token && !error && <FinanceRefunds token={token} canRequest={permissions.includes('finance.refunds.request')} canApprove={permissions.includes('finance.refunds.approve')} canExecute={permissions.includes('finance.refunds.execute')} />}
  </main>;
}
