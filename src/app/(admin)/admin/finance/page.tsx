'use client';
import { useEffect, useState } from 'react';
import {CalendarClock, Wallet} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import type { FinanceReport } from '@/lib/payments/reconciliation-service';
import { FinanceRefunds } from '@/components/admin/finance/finance-refunds';
import { AiBudgetReport } from '@/components/admin/finance/ai-budget-report';
import { PaymentValidationMetrics } from '@/components/admin/finance/payment-validation-metrics';
import { FinancePackages } from '@/components/admin/finance/finance-packages';
import {PaymentOrderManagement} from '@/components/admin/finance/payment-orders';
import {CallbackAlerts} from '@/components/admin/finance/callback-alerts';
import {ChannelReconciliation} from '@/components/admin/finance/channel-reconciliation';
import {ChargeReconciliationPanel} from '@/components/admin/finance/charge-reconciliation-panel';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel, AdminPlaceholder, AdminStat, AdminStatGrid} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Select} from '@/components/ui/select';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';

/** 分转元，统一保留两位小数。 */
function yuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function FinancePage() {
  const { token, isLoading } = useAuth();
  const {permissions} = useAdminAccess();
  const [tab, setTab] = useState('orders');
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
    fetch(`/api/admin/finance/report?days=${days}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => setReport(data))
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, isLoading, days, refresh]);

  const canReadFinance = Boolean(token) && permissions.includes('finance.read');
  // 费用单接口要 billing.read；财务查看员只有 finance.read，没权限时给明确提示而不是让它报错。
  const canReadBilling = permissions.includes('billing.read');

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="财务与支付"
        title="财务支付"
        description="本地订单、金币流水与费用单核对。支付渠道账单与真实退款需另行核验。"
        actions={tab === 'orders' ? (
          <>
            <div className="w-32">
              <Select aria-label="统计范围" value={days} onChange={event => setDays(Number(event.target.value))}>
                {[1, 7, 30, 90].map(value => <option key={value} value={value}>近 {value} 天</option>)}
              </Select>
            </div>
            <Button variant="outline" disabled={!token || loading} onClick={() => setRefresh(n => n + 1)}>刷新</Button>
          </>
        ) : undefined}
      />
      <Tabs value={tab} onValueChange={value => setTab(value === 'reconcile' ? 'reconcile' : 'orders')}>
        <TabsList aria-label="财务标签">
          <TabsTrigger value="orders">订单与退款</TabsTrigger>
          <TabsTrigger value="reconcile">异常核对</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="flex flex-col gap-6">
        {error && <AdminNotice tone="error" title={error} />}
        {loading && <AdminNotice tone="loading" title="正在核对订单与流水…" />}
        {report && <>
          <AdminStatGrid>
            <AdminStat label="已付款订单" value={`${report.paidOrders} 笔`} hint={yuan(report.paidAmountCnyCents)} icon={<Wallet className="h-4 w-4" />} tone="brand" />
            <AdminStat label="已完成退款" value={`${report.completedRefunds} 笔`} hint={yuan(report.refundedAmountCnyCents)} tone="warning" />
            <AdminStat label="退款后金额" value={yuan(report.netAfterRefundsCnyCents)} hint="不含通道手续费、结算费用与 AI 成本" tone="success" />
            <AdminStat label="报告时间" value={new Date(report.generatedAt).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})} hint={new Date(report.generatedAt).toLocaleDateString('zh-CN')} icon={<CalendarClock className="h-4 w-4" />} />
          </AdminStatGrid>

          <FinancePackages token={token!} canEdit={permissions.includes('finance.packages.write')} />

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
        </>}
        {canReadFinance && <PaymentOrderManagement token={token!} />}
        {canReadFinance && <CallbackAlerts token={token!} />}
        {canReadFinance && <ChannelReconciliation token={token!} canImport={permissions.includes('finance.reconciliation.import')} />}
        {token && !error && <FinanceRefunds token={token} canRequest={permissions.includes('finance.refunds.request')} canApprove={permissions.includes('finance.refunds.approve')} canExecute={permissions.includes('finance.refunds.execute')} />}
        </TabsContent>
        <TabsContent value="reconcile" className="flex flex-col gap-6">
          {canReadBilling
            ? <ChargeReconciliationPanel token={token} canRun={permissions.includes('tasks.manage')} />
            : <AdminNotice tone="denied" title="当前账号没有计费查看权限，无法查看费用单。" />}
        </TabsContent>
      </Tabs>
    </AdminPage>
  );
}