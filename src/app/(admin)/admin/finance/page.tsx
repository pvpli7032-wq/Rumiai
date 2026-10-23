'use client';
import { useEffect, useState } from 'react';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import type { FinanceReport } from '@/lib/payments/reconciliation-service';
import { AdminNotice, AdminPage, AdminPageHeader } from '@/components/admin/admin-page';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FinanceOverview } from '@/components/admin/finance/finance-overview';
import { FinanceRefunds } from '@/components/admin/finance/finance-refunds';
import { FinancePackages } from '@/components/admin/finance/finance-packages';
import { FinanceMerchants } from '@/components/admin/finance/finance-merchants';
import { PaymentOrderManagement } from '@/components/admin/finance/payment-orders';
import { CallbackAlerts } from '@/components/admin/finance/callback-alerts';
import { ChannelReconciliation } from '@/components/admin/finance/channel-reconciliation';
import { ChargeReconciliationPanel } from '@/components/admin/finance/charge-reconciliation-panel';

/**
 * 财务支付（V3 表 14）：订单为默认标签，退款／套餐／对账／商户各自成标签。
 *
 * 每个标签只放自己那一件事：订单标签是经营概览 + 订单列表，
 * 退款处理在订单详情抽屉内，套餐表单不再堆在订单页上。
 */
const TABS = [
  { value: 'orders', label: '订单' },
  { value: 'refunds', label: '退款' },
  { value: 'packages', label: '套餐' },
  { value: 'reconcile', label: '对账' },
  { value: 'merchants', label: '商户' },
] as const;
type TabValue = (typeof TABS)[number]['value'];

export default function FinancePage() {
  const { sessionActive, loading: accessLoading } = useAdminAccess();
  const { permissions } = useAdminAccess();
  const [tab, setTab] = useState<TabValue>('orders');
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  /** 退款台账点「在订单详情处理」时带过来的订单号；订单标签消费一次后清空。 */
  const [focusOrderNo, setFocusOrderNo] = useState('');

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
        actions={tab === 'orders' ? (
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
      <Tabs value={tab} onValueChange={value => setTab(TABS.some(item => item.value === value) ? value as TabValue : 'orders')}>
        <TabsList aria-label="财务标签">
          {TABS.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="orders" className="flex flex-col gap-6">
          {canReadFinance
            ? <>
                <FinanceOverview report={report} loading={loading} error={error} />
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

        <TabsContent value="refunds" className="flex flex-col gap-6">
          {canReadFinance
            ? <FinanceRefunds sessionActive={sessionActive!} onOpenOrder={orderNo => { setFocusOrderNo(orderNo); setTab('orders'); }} />
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

        <TabsContent value="merchants" className="flex flex-col gap-6">
          {sessionActive ? <FinanceMerchants sessionActive={sessionActive} permissions={permissions} /> : <AdminNotice tone="denied" title="请先登录财务管理员账号。" />}
        </TabsContent>
      </Tabs>
    </AdminPage>
  );
}
