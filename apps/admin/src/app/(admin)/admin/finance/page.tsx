'use client';
import { useEffect, useState } from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {useAdminAccess} from '@admin/components/use-admin-access';
import type { FinanceReport } from '@rumiai/contracts/admin/finance';
import { AdminNotice, AdminPage, AdminPageHeader } from '@admin/components/admin-page';
import { Button } from '@rumiai/ui/button';
import { Select } from '@rumiai/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@rumiai/ui/tabs';
import { FinanceOverview } from '@admin/components/finance/finance-overview';
import { FinanceRefunds } from '@admin/components/finance/finance-refunds';
import { FinancePackages } from '@admin/components/finance/finance-packages';
import { PaymentOrderManagement } from '@admin/components/finance/payment-orders';
import { CallbackAlerts } from '@admin/components/finance/callback-alerts';
import { ChannelReconciliation } from '@admin/components/finance/channel-reconciliation';
import { ChargeReconciliationPanel } from '@admin/components/finance/charge-reconciliation-panel';

/**
 * 财务支付（V3 表 14）：订单为默认标签，退款／套餐／对账／商户各自成标签。
 *
 * 每个标签只放自己那一件事：订单标签是经营概览 + 订单列表，
 * 退款处理在订单详情抽屉内，套餐表单不再堆在订单页上。
 */
const TABS = [
  { value: 'orders', label: '订单' },
  { value: 'overview', label: '经营概览' },
  { value: 'refunds', label: '退款' },
  { value: 'packages', label: '套餐' },
  { value: 'reconcile', label: '对账' },
] as const;
type TabValue = (typeof TABS)[number]['value'];

export default function FinancePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sessionActive, loading: accessLoading } = useAdminAccess();
  const { permissions } = useAdminAccess();
  const requestedTab = searchParams.get('tab');
  const tab: TabValue = TABS.some(item => item.value === requestedTab) ? requestedTab as TabValue : 'orders';
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  /** 退款台账点「在订单详情处理」时带过来的订单号；订单标签消费一次后清空。 */
  const [focusOrderNo, setFocusOrderNo] = useState('');

  function selectTab(value: string, replace = false) {
    const next = TABS.some(item => item.value === value) ? value as TabValue : 'orders';
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'orders') params.delete('tab'); else params.set('tab', next);
    const href = params.size ? `/admin/finance?${params}` : '/admin/finance';
    if (replace) router.replace(href, {scroll: false}); else router.push(href, {scroll: false});
  }

  useEffect(() => {
    if (requestedTab === 'merchants') {
      router.replace('/admin/payments/merchants', {scroll: false});
      return;
    }
    if (requestedTab && !TABS.some(item => item.value === requestedTab)) selectTab('orders', true);
    // 仅在 URL tab 变化时规范未知值；selectTab 读取的 searchParams 同次渲染稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setError(''); setLoading(false);
    if (!sessionActive) { if (!accessLoading) setError('请先登录财务管理员账号。'); return; }
    setLoading(true);
    fetch(`/api/admin/finance/report?days=${days}`, {credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => setReport(data))
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionActive, accessLoading, days, refresh]);

  const canReadFinance = Boolean(sessionActive) && permissions.includes('finance.read');
  // 费用单接口要 billing.read；财务查看员只有 finance.read，没权限时给明确提示而不是让它报错。
  const canReadBilling = permissions.includes('billing.read');

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="财务与支付"
        title="财务支付"
        description="本地订单、金币流水与费用单核对。支付渠道账单与真实退款需另行核验。"
        actions={tab === 'orders' || tab === 'overview' ? (
          <>
            <div className="w-32">
              <Select aria-label="统计范围" value={days} onChange={event => setDays(Number(event.target.value))}>
                {[1, 7, 30, 90].map(value => <option key={value} value={value}>近 {value} 天</option>)}
              </Select>
            </div>
            <Button variant="outline" disabled={!sessionActive || loading} onClick={() => setRefresh(n => n + 1)}>刷新</Button>
          </>
        ) : undefined}
      />
      <Tabs value={tab} onValueChange={value => selectTab(value)}>
        <TabsList aria-label="财务标签">
          {TABS.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="orders" className="flex flex-col gap-6">
          {canReadFinance
            ? <>
                <PaymentOrderManagement
                  sessionActive={sessionActive!}
                  canRequest={permissions.includes('finance.refunds.request')}
                  canApprove={permissions.includes('finance.refunds.approve')}
                  canExecute={permissions.includes('finance.refunds.execute')}
                  focusOrderNo={focusOrderNo}
                  onFocusHandled={() => setFocusOrderNo('')}
                />
              </>
            : <AdminNotice tone="denied" title="当前账号没有财务查看权限。" />}
        </TabsContent>

        <TabsContent value="overview" className="flex flex-col gap-6">
          {canReadFinance ? <FinanceOverview report={report} loading={loading} error={error} /> : <AdminNotice tone="denied" title="当前账号没有财务查看权限。" />}
        </TabsContent>

        <TabsContent value="refunds" className="flex flex-col gap-6">
          {canReadFinance
            ? <FinanceRefunds sessionActive={sessionActive!} onOpenOrder={orderNo => { setFocusOrderNo(orderNo); selectTab('orders'); }} />
            : <AdminNotice tone="denied" title="当前账号没有财务查看权限。" />}
        </TabsContent>

        <TabsContent value="packages" className="flex flex-col gap-6">
          {sessionActive && !error
            ? <FinancePackages sessionActive={sessionActive} canEdit={permissions.includes('finance.packages.write')} />
            : <AdminNotice tone="denied" title={error || '请先登录财务管理员账号。'} />}
        </TabsContent>

        <TabsContent value="reconcile" className="flex flex-col gap-6">
          {canReadFinance && <ChannelReconciliation sessionActive={sessionActive!} canImport={permissions.includes('finance.reconciliation.import')} />}
          {canReadFinance && <CallbackAlerts sessionActive={sessionActive!} />}
          {canReadBilling
            ? <ChargeReconciliationPanel sessionActive={sessionActive} canRun={permissions.includes('tasks.manage')} />
            : <AdminNotice tone="denied" title="当前账号没有计费查看权限，无法查看费用单。" />}
        </TabsContent>

      </Tabs>
    </AdminPage>
  );
}
