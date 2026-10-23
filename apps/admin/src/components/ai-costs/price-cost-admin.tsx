'use client';

import {RefreshCw} from 'lucide-react';
import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel, AdminStat, AdminStatGrid} from '@admin/components/admin-page';
import {useAdminAccess} from '@admin/components/use-admin-access';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {Select} from '@rumiai/ui/select';
import {apiFetch} from '@admin/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {BillingSummaryPanel} from './billing-summary-panel';
import {BudgetPanel, type BudgetDraft} from './budget-panel';
import {CostCurrencyPanel, UnpricedModelsPanel} from './cost-breakdown';
import {ModelPriceDrawer, type PriceDraft} from './model-price-drawer';
import {PriceTable, PricingBasisNote} from './price-table';
import {TaskBudgetPanel} from './task-budget-panel';
import {TaskModelPanel} from './task-model-panel';
import {NOT_ENOUGH_SAMPLE, formatAmount, formatCoins, type ModelPriceRow} from './types';
import {usePriceCostData} from './use-price-cost-data';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@rumiai/ui/tabs';

const COST_TABS = ['pricing','analysis','budget'] as const;
type CostTab = (typeof COST_TABS)[number];

/**
 * 「价格与成本」（V3 §17、§28）。
 *
 * 三个问题：用户付多少币（收费币价）、平台花多少钱（供应商成本价与已计量成本）、
 * 有没有收益（收入估算与贡献毛利）。两类价格来自不同接口、不同单位，永远分列显示；
 * 缺成本价写「待配置」，样本不够写「样本不足」，没登记汇率时不编毛利、不给建议价。
 */
export function PriceCostAdmin() {
  const router=useRouter(),searchParams=useSearchParams();
  const requestedTab=searchParams.get('tab');
  const tab:CostTab=COST_TABS.includes(requestedTab as CostTab)?requestedTab as CostTab:'pricing';
  const {sessionActive, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const canRead = permissions.includes('ai.costs.read');
  const canManage = permissions.includes('ai.costs.manage');
  // 币价写入属于计费（billing.manage），预算与熔断属于 AI 成本（ai.costs.manage）；两个开关各自独立，
  // 否则只有其一的账号会看到可点按钮却拿到 403。
  const canManageBilling = permissions.includes('billing.manage');
  const canReadBilling = permissions.includes('billing.read');
  const canReadSettings = permissions.includes('settings.read');
  const canWriteSettings = permissions.includes('settings.write');

  const data = usePriceCostData({sessionActive, canRead, canReadBilling, canReadSettings});
  const {days, setDays, coinView, costView, dashboard, billingValues, loading, error, setError, refresh, rows, summary} = data;
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<ModelPriceRow | null>(null);
  const [busy, setBusy] = useState(false);
  const selectTab=useCallback((value:string,replace=false)=>{const next=COST_TABS.includes(value as CostTab)?value as CostTab:'pricing';const params=new URLSearchParams(searchParams.toString());if(next==='pricing')params.delete('tab');else params.set('tab',next);const href=params.size?`/admin/ai/costs?${params}`:'/admin/ai/costs';if(replace)router.replace(href,{scroll:false});else router.push(href,{scroll:false});},[router,searchParams]);
  useEffect(()=>{if(requestedTab&&!COST_TABS.includes(requestedTab as CostTab))selectTab('pricing',true);},[requestedTab,selectTab]);

  const pricing = coinView?.pricing ?? null;
  const minSampleText = pricing ? `样本少于 ${pricing.minSample} 条显示「样本不足」` : '样本阈值来自设置中心';
  /** 汇率登记之后才谈毛利；没登记就只说「并列展示」，不给数字。 */
  const marginNote = pricing && pricing.exchange.rate !== null
    ? `汇率 ${pricing.exchange.rate} 人民币/成本币：贡献毛利 =（收费币价 × 每币单价 − 每条成本 × 汇率）÷（收费币价 × 每币单价）。建议币价按「成本 → 目标收入 → 币」倒推并向上取整，仅供参考，手动定价始终可用。`
    : '毛利口径：预计收入以「币」计，供应商成本以「币种金额」计；在没有登记换算口径前只并列展示，不推算毛利。真正的现金充值、退款与对账留在财务页。';

  async function savePrice(row: ModelPriceRow, draft: PriceDraft) {
    if (!sessionActive || busy) return;
    const effective = new Date(draft.effectiveAt);
    if (Number.isNaN(effective.getTime())) { setError('生效时间格式不正确。'); return; }
    const effectiveAt = effective.toISOString();
    const coins = Number(draft.coinsPerReply);
    const coinChanged = coins !== (row.coinPrice?.coinsPerReply ?? null);
    const wantsCost = Boolean(draft.inputPricePerMillion.trim() || draft.outputPricePerMillion.trim());
    const costChanged = wantsCost && (
      draft.inputPricePerMillion.trim() !== (row.costPrice?.inputPricePerMillion ?? '')
      || draft.outputPricePerMillion.trim() !== (row.costPrice?.outputPricePerMillion ?? '')
      || draft.currency !== (row.costPrice?.currency ?? '')
    );

    if (!coinChanged && !costChanged) {
      setNotice('价格没有变化，未追加新版本。');
      setEditing(null);
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    const problems: string[] = [];
    const saved: string[] = [];
    if (coinChanged) {
      try {
        await apiFetch(API.admin.coinPrices, {credentials: 'same-origin', method: 'POST', body: {modelId: row.id, coinsPerReply: coins, effectiveAt}});
        saved.push('收费币价');
      } catch (cause) {
        problems.push(`收费币价：${cause instanceof Error ? cause.message : '保存失败。'}`);
      }
    }
    if (costChanged) {
      try {
        // 成本价接口是 POST /api/admin/ai/prices，路径表登记为 API.admin.ai.prices。
        await apiFetch(API.admin.ai.prices, {
          credentials: 'same-origin',
          method: 'POST',
          body: {
            modelId: row.id,
            currency: draft.currency,
            inputPricePerMillion: draft.inputPricePerMillion.trim(),
            outputPricePerMillion: draft.outputPricePerMillion.trim(),
            effectiveAt,
            source: draft.source.trim(),
            reason: draft.reason.trim(),
          },
        });
        saved.push('供应商成本价');
      } catch (cause) {
        problems.push(`成本价：${cause instanceof Error ? cause.message : '保存失败。'}`);
      }
    }
    if (problems.length > 0) setError(problems.join('；'));
    if (saved.length > 0) {
      setNotice(`${row.displayName} 已追加 ${saved.join(' 与 ')} 版本，从新请求开始生效。`);
      setEditing(null);
    }
    setBusy(false);
    refresh();
  }

  async function saveBudget(draft: BudgetDraft) {
    if (!sessionActive || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(API.admin.ai.costs, {
        credentials: 'same-origin',
        method: 'POST',
        body: {
          type: 'budget',
          value: {
            currency: draft.currency.trim().toUpperCase(),
            siteLimit: draft.siteLimit === '' ? null : Number(draft.siteLimit),
            userLimit: draft.userLimit === '' ? null : Number(draft.userLimit),
            isActive: draft.isActive,
            version: draft.version,
            reason: draft.reason.trim(),
          },
        },
      });
      setNotice(`${draft.currency} 日预算已保存并写入操作审计。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '预算保存失败，请稍后重试。');
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function saveBreaker(enabled: boolean, reason: string, version: number) {
    if (!sessionActive || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(API.admin.ai.costs, {credentials: 'same-origin', method: 'POST', body: {type: 'circuit-breaker', value: {enabled, version, reason}}});
      setNotice(enabled ? '预算熔断已启用并写入操作审计。' : '预算熔断已关闭并写入操作审计。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '熔断策略保存失败，请稍后重试。');
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (accessLoading) return <AdminPage><AdminNotice tone="loading" title="正在验证管理权限…" /></AdminPage>;
  if (!sessionActive || !canRead) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有「价格与成本」查看权限。'} /></AdminPage>;

  const costValue = summary.costRows.length === 0
    ? '暂无调用'
    : summary.costRows.length === 1
      ? formatAmount(summary.costRows[0].estimatedCost, summary.costRows[0].currency)
      : `${summary.costRows.length} 种币种`;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="AI 平台"
        title="价格与成本"
        description="用户付多少币、平台花多少钱、有没有收益，三个问题分开回答；收费币价与供应商成本价分列，互不覆盖。"
        actions={
          <>
            <div className="w-32">
              <Select aria-label="统计范围" value={days} onChange={event => setDays(Number(event.target.value))}>
                {[1, 7, 30, 90].map(value => <option key={value} value={value}>近 {value} 天</option>)}
              </Select>
            </div>
            <Button variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loading} onClick={refresh}>刷新</Button>
          </>
        }
      />

      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {notice && <AdminNotice tone="success" title={notice} className="py-6" />}
      {loading && !costView && <AdminNotice tone="loading" title="正在读取价格与成本…" />}

      <Tabs value={tab} onValueChange={value => selectTab(value)}>
        <TabsList aria-label="价格与成本工作区">
          <TabsTrigger value="pricing">AI 币价</TabsTrigger>
          <TabsTrigger value="analysis">成本分析</TabsTrigger>
          <TabsTrigger value="budget">预算控制</TabsTrigger>
        </TabsList>

      <TabsContent value="analysis" keepMounted>
      <AdminStatGrid className="xl:grid-cols-3">
        <AdminStat
          label={`已计量模型成本（${days} 天）`}
          value={costValue}
          hint={summary.costRows.length
            ? summary.costRows.map(row => `${row.currency} ${formatAmount(row.estimatedCost, row.currency)}`).join(' · ')
            : `近 ${days} 天没有 AI 调用记录`}
          tone="brand"
        />
        <AdminStat
          label="聊天收入估算"
          value={summary.settledCount === 0 ? NOT_ENOUGH_SAMPLE : formatCoins(summary.settledCoins)}
          hint={summary.settledCount === 0
            ? (canReadBilling ? '还没有已结算的费用单' : '当前账号没有计费查看权限')
            : `最近 ${summary.settledCount} 条已结算费用单；币数未折算成币种金额`}
        />
        <AdminStat
          label="费用未知调用数"
          value={String(summary.unknownCalls)}
          hint="未定价模型、缺失用量或不完整重试；未知不按 0 计算"
          tone={summary.unknownCalls > 0 ? 'warning' : 'default'}
        />
      </AdminStatGrid>
      <BillingSummaryPanel values={billingValues} />
      {dashboard && <CostCurrencyPanel rows={dashboard.costs} days={days} />}
      {dashboard && <UnpricedModelsPanel models={dashboard.budget.pricingUnpricedModels} />}
      </TabsContent>

      <TabsContent value="pricing" keepMounted>
      <AdminPanel
        title="模型价格"
        description={`收费币价按「币/条」、成本价按「每百万 Token」分别列示；平均成本、预计收入、贡献毛利与建议币价取所选区间，${minSampleText}。`}
        badge={rows.length ? <Badge>{rows.length} 个模型</Badge> : undefined}
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            汇率、目标毛利与最小样本
          </Link>
        }
        flush
        bodyClassName="p-5"
      >
        {pricing ? (
          <>
            <PricingBasisNote pricing={pricing} />
            <PriceTable
              rows={rows}
              days={days}
              pricing={pricing}
              loading={loading && !costView}
              error={error || undefined}
              busy={busy}
              onRetry={refresh}
              onEdit={row => { setEditing(row); setError(''); setNotice(''); }}
            />
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{marginNote}</p>
          </>
        ) : (
          <AdminNotice tone="loading" title="正在读取价格与成本…" />
        )}
      </AdminPanel>

      {coinView && <TaskModelPanel view={coinView} sessionActive={sessionActive} canWrite={canWriteSettings} onSaved={refresh} />}
      </TabsContent>

      <TabsContent value="budget" keepMounted>
      {dashboard && dashboard.taskBudgets.length > 0 && <TaskBudgetPanel rows={dashboard.taskBudgets} />}
      {dashboard && (
        <BudgetPanel
          rows={dashboard.settings.rows}
          source={dashboard.settings.source}
          status={dashboard.settings.status}
          circuitBreaker={dashboard.settings.circuitBreaker}
          circuitBreakerVersion={dashboard.settings.circuitBreakerVersion}
          canManage={canManage}
          busy={busy}
          onSaveBudget={draft => void saveBudget(draft)}
          onSaveBreaker={(enabled, reason, version) => void saveBreaker(enabled, reason, version)}
        />
      )}
      </TabsContent>
      </Tabs>

      <ModelPriceDrawer
        key={editing?.id ?? 'none'}
        row={editing}
        canManage={canManageBilling}
        busy={busy}
        onClose={() => setEditing(null)}
        onSubmit={(row, draft) => void savePrice(row, draft)}
      />
    </AdminPage>
  );
}
