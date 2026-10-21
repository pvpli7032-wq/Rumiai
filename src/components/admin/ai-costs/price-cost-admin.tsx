'use client';

import {RefreshCw} from 'lucide-react';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel, AdminStat, AdminStatGrid} from '@/components/admin/admin-page';
import {DataTable} from '@/components/admin/layout/data-table';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Select} from '@/components/ui/select';
import {apiFetch} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {BudgetPanel, type BudgetDraft} from './budget-panel';
import {ModelPriceDrawer, type PriceDraft} from './model-price-drawer';
import {
  COST_AVERAGE_MIN_SAMPLE,
  NOT_CONFIGURED,
  NOT_ENOUGH_SAMPLE,
  formatAmount,
  formatCoins,
  formatDateTime,
  pickEffective,
  type ChargePage,
  type CoinPriceItem,
  type CoinPriceView,
  type CostDashboard,
  type CostPriceView,
  type ModelPriceRow,
} from './types';

type BillingSettingRow = {key: string; value: unknown};

const BILLING_KEYS = ['billing.chargingEnabled', 'billing.freeDailyMessages', 'billing.priceMultiplier'] as const;

/**
 * 「价格与成本」（V3 §17）。
 *
 * 三个问题：用户付多少币（收费币价）、平台花多少钱（供应商成本价与已计量成本）、
 * 有没有收益（收入估算）。两类价格来自不同接口、不同单位，永远分列显示；
 * 缺成本价写「待配置」，样本不够写「样本不足」，没有换算口径时不编毛利。
 */
export function PriceCostAdmin() {
  const {token, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const canRead = permissions.includes('ai.costs.read');
  const canManage = permissions.includes('ai.costs.manage');
  const canReadBilling = permissions.includes('billing.read');
  const canReadSettings = permissions.includes('settings.read');

  const [days, setDays] = useState(7);
  const [coinView, setCoinView] = useState<CoinPriceView | null>(null);
  const [costView, setCostView] = useState<CostPriceView | null>(null);
  const [dashboard, setDashboard] = useState<CostDashboard | null>(null);
  const [charges, setCharges] = useState<ChargePage | null>(null);
  const [billingValues, setBillingValues] = useState<Partial<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<ModelPriceRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [coins, prices, costs] = await Promise.all([
        apiFetch<CoinPriceView>(API.admin.coinPrices, {token, cache: 'no-store'}),
        apiFetch<CostPriceView>(API.admin.ai.prices, {token, cache: 'no-store'}),
        apiFetch<CostDashboard>(API.admin.ai.costs + `?days=${days}`, {token, cache: 'no-store'}),
      ]);
      setCoinView(coins);
      setCostView(prices);
      setDashboard(costs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '价格与成本数据加载失败。');
    } finally {
      setLoading(false);
    }
  }, [token, days]);

  useEffect(() => {
    setCoinView(null);
    setCostView(null);
    setDashboard(null);
    if (token && canRead) void load();
  }, [token, canRead, days, refreshKey, load]);

  // 收入估算：只取已结算费用单的币数样本，不把币硬折成币种金额。
  useEffect(() => {
    if (!token || !canReadBilling) { setCharges(null); return; }
    const controller = new AbortController();
    void apiFetch<ChargePage>(API.admin.billingCharges(new URLSearchParams({status: 'SETTLED', limit: '50'}).toString()), {
      token,
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(data => { if (!controller.signal.aborted) setCharges(data); })
      .catch(() => { if (!controller.signal.aborted) setCharges(null); });
    return () => controller.abort();
  }, [token, canReadBilling, refreshKey]);

  // 免费额度与收费开关：只读摘要 + 跳转，设置中心是唯一编辑位置。
  useEffect(() => {
    if (!token || !canReadSettings) { setBillingValues(null); return; }
    const controller = new AbortController();
    void apiFetch<{values: BillingSettingRow[]}>(API.admin.settings + '?group=billing', {token, cache: 'no-store', signal: controller.signal})
      .then(data => {
        if (controller.signal.aborted) return;
        const picked: Partial<Record<string, unknown>> = {};
        for (const key of BILLING_KEYS) {
          const row = data.values.find(item => item.key === key);
          if (row) picked[key] = row.value;
        }
        setBillingValues(picked);
      })
      .catch(() => { if (!controller.signal.aborted) setBillingValues(null); });
    return () => controller.abort();
  }, [token, canReadSettings, refreshKey]);

  const rows = useMemo<ModelPriceRow[]>(() => {
    if (!costView) return [];
    const coinsByModel = new Map<string, CoinPriceItem[]>();
    for (const item of coinView?.items ?? []) {
      const list = coinsByModel.get(item.modelId) ?? [];
      list.push(item);
      coinsByModel.set(item.modelId, list);
    }
    return costView.models.map(model => {
      const coin = pickEffective(coinsByModel.get(model.id) ?? []);
      const cost = pickEffective(model.prices);
      return {
        id: model.id,
        key: model.key,
        displayName: model.displayName,
        providerName: model.providerName,
        modelCode: model.modelCode,
        isActive: model.isActive,
        coinPrice: coin.current,
        coinPricePending: coin.pending,
        costPrice: cost.current,
        costPricePending: cost.pending,
        usage: (dashboard?.modelCosts ?? []).filter(item => item.modelId === model.id),
      } satisfies ModelPriceRow;
    });
  }, [costView, coinView, dashboard]);

  const summary = useMemo(() => {
    const costs = dashboard?.costs ?? [];
    const unknownCalls = costs.reduce((sum, row) => sum + row.unknownCostCalls, 0);
    const settled = charges?.items ?? [];
    return {
      costRows: costs,
      unknownCalls,
      settledCount: settled.length,
      settledCoins: settled.reduce((sum, row) => sum + row.coins, 0),
    };
  }, [dashboard, charges]);

  async function savePrice(row: ModelPriceRow, draft: PriceDraft) {
    if (!token || busy) return;
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
        await apiFetch(API.admin.coinPrices, {token, method: 'POST', body: {modelId: row.id, coinsPerReply: coins, effectiveAt}});
        saved.push('收费币价');
      } catch (cause) {
        problems.push(`收费币价：${cause instanceof Error ? cause.message : '保存失败。'}`);
      }
    }
    if (costChanged) {
      try {
        // 成本价接口是 POST /api/admin/ai/prices，路径表登记为 API.admin.ai.prices。
        await apiFetch(API.admin.ai.prices, {
          token,
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
    setRefreshKey(value => value + 1);
  }

  async function saveBudget(draft: BudgetDraft) {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(API.admin.ai.costs, {
        token,
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
      setRefreshKey(value => value + 1);
    }
  }

  async function saveBreaker(enabled: boolean, reason: string, version: number) {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(API.admin.ai.costs, {token, method: 'POST', body: {type: 'circuit-breaker', value: {enabled, version, reason}}});
      setNotice(enabled ? '预算熔断已启用并写入操作审计。' : '预算熔断已关闭并写入操作审计。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '熔断策略保存失败，请稍后重试。');
    } finally {
      setBusy(false);
      setRefreshKey(value => value + 1);
    }
  }

  if (accessLoading) return <AdminPage><AdminNotice tone="loading" title="正在验证管理权限…" /></AdminPage>;
  if (!token || !canRead) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有「价格与成本」查看权限。'} /></AdminPage>;

  const costValue = summary.costRows.length === 0
    ? '暂无调用'
    : summary.costRows.length === 1
      ? formatAmount(summary.costRows[0].estimatedCost, summary.costRows[0].currency)
      : `${summary.costRows.length} 种币种`;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="AI 与商业"
        title="价格与成本"
        description="用户付多少币、平台花多少钱、有没有收益，三个问题分开回答；收费币价与供应商成本价分列，互不覆盖。"
        actions={
          <>
            <div className="w-32">
              <Select aria-label="统计范围" value={days} onChange={event => setDays(Number(event.target.value))}>
                {[1, 7, 30, 90].map(value => <option key={value} value={value}>近 {value} 天</option>)}
              </Select>
            </div>
            <Button variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loading} onClick={() => setRefreshKey(value => value + 1)}>刷新</Button>
          </>
        }
      />

      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {notice && <AdminNotice tone="success" title={notice} className="py-6" />}
      {loading && !costView && <AdminNotice tone="loading" title="正在读取价格与成本…" />}

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

      <AdminPanel
        title="模型价格"
        description="收费币价按「币/条」、成本价按「每百万 Token」分别列示；平均成本与预计收入取所选区间，样本少于 5 次显示「样本不足」。"
        badge={rows.length ? <Badge>{rows.length} 个模型</Badge> : undefined}
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            免费额度与收费开关
          </Link>
        }
        flush
        bodyClassName="p-5"
      >
        <DataTable
          rows={rows}
          getRowId={row => row.id}
          loading={loading && !costView}
          emptyTitle="还没有登记模型路由"
          emptyDescription="先在「模型服务」里登记模型，再回来定价。"
          error={error || undefined}
          onRetry={() => setRefreshKey(value => value + 1)}
          columns={[
            {
              id: 'model',
              header: '模型',
              cell: row => (
                <span className="block max-w-xs">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-medium">{row.displayName}</span>
                    <Badge variant={row.isActive ? 'success' : 'neutral'}>{row.isActive ? '启用' : '停用'}</Badge>
                  </span>
                  <span className="mt-0.5 block break-all text-xs text-muted-foreground">{row.providerName} · {row.modelCode}</span>
                </span>
              ),
            },
            {
              id: 'coinPrice',
              header: '收费币价',
              width: '180px',
              cell: row => row.coinPrice ? (
                <span className="block text-xs">
                  <span className="block font-medium text-foreground">{formatCoins(row.coinPrice.coinsPerReply)}/条</span>
                  <span className="mt-0.5 block text-muted-foreground">v{row.coinPrice.version} · {formatDateTime(row.coinPrice.effectiveAt)}</span>
                </span>
              ) : (
                <span className="block text-xs">
                  <span className="block text-muted-foreground">{NOT_CONFIGURED}</span>
                  {row.coinPricePending && <span className="mt-0.5 block text-muted-foreground">待生效 {formatDateTime(row.coinPricePending.effectiveAt)}</span>}
                </span>
              ),
            },
            {
              id: 'costPrice',
              header: '成本价（输入/输出）',
              width: '200px',
              cell: row => row.costPrice ? (
                <span className="block text-xs">
                  <span className="block font-medium text-foreground">{row.costPrice.currency} {row.costPrice.inputPricePerMillion} / {row.costPrice.outputPricePerMillion}</span>
                  <span className="mt-0.5 block text-muted-foreground">每百万 Token · {formatDateTime(row.costPrice.effectiveAt)}</span>
                </span>
              ) : (
                <span className="block text-xs">
                  <span className="block text-muted-foreground">{NOT_CONFIGURED}</span>
                  {row.costPricePending && <span className="mt-0.5 block text-muted-foreground">待生效 {formatDateTime(row.costPricePending.effectiveAt)}</span>}
                </span>
              ),
            },
            {
              id: 'averageCost',
              header: `近 ${days} 天平均成本`,
              width: '200px',
              cell: row => {
                if (row.usage.length === 0) return <span className="text-xs text-muted-foreground">{NOT_ENOUGH_SAMPLE}</span>;
                return (
                  <span className="block space-y-1 text-xs">
                    {row.usage.map(item => (
                      <span key={item.currency} className="block break-words">
                        {item.calls < COST_AVERAGE_MIN_SAMPLE
                          ? <span className="text-muted-foreground">{NOT_ENOUGH_SAMPLE}（{item.calls} 次调用）</span>
                          : <span>{formatAmount(item.estimatedCost / item.calls, item.currency)}/次{item.unknownCostCalls > 0 ? `（${item.unknownCostCalls} 次未知成本）` : ''}</span>}
                      </span>
                    ))}
                  </span>
                );
              },
            },
            {
              id: 'revenue',
              header: `预计收入（${days} 天）`,
              width: '170px',
              cell: row => {
                const usage = row.usage[0];
                if (!row.coinPrice) return <span className="text-xs text-muted-foreground">{NOT_CONFIGURED}</span>;
                if (!usage || usage.calls === 0) return <span className="text-xs text-muted-foreground">{NOT_ENOUGH_SAMPLE}</span>;
                if (usage.calls < COST_AVERAGE_MIN_SAMPLE) return <span className="text-xs text-muted-foreground">{NOT_ENOUGH_SAMPLE}（{usage.calls} 次调用）</span>;
                return <span className="text-xs">{formatCoins(row.coinPrice.coinsPerReply * usage.calls)}</span>;
              },
            },
            {
              id: 'margin',
              header: '贡献毛利',
              width: '130px',
              cell: () => <span className="text-xs text-muted-foreground" title="币与成本币种之间没有登记换算口径，不展示推算毛利">{NOT_CONFIGURED}</span>,
            },
            {
              id: 'actions',
              header: '操作',
              width: '100px',
              cell: row => (
                <Button size="sm" variant="outline" aria-label={`编辑价格 ${row.displayName}`} disabled={busy} onClick={() => { setEditing(row); setError(''); setNotice(''); }}>
                  编辑
                </Button>
              ),
            },
          ]}
        />
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          毛利口径：预计收入以「币」计，供应商成本以「币种金额」计；在没有登记换算口径前只并列展示，不推算毛利。真正的现金充值、退款与对账留在财务页。
        </p>
      </AdminPanel>

      <AdminPanel
        title="免费额度与收费开关"
        description="规则只有一份，在设置中心「计费额度」里修改；这里只显示当前值。"
        badge={billingValues ? undefined : <Badge variant="outline">无设置查看权限</Badge>}
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            去设置中心
          </Link>
        }
      >
        {billingValues ? (
          <dl className="divide-y divide-border text-sm">
            <div className="flex flex-wrap items-baseline gap-2 py-3">
              <dt className="w-36 shrink-0 text-muted-foreground">聊天收费</dt>
              <dd className="font-medium">{billingValues['billing.chargingEnabled'] === true ? '已开启' : '关闭'}</dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-2 py-3">
              <dt className="w-36 shrink-0 text-muted-foreground">每日免费回复</dt>
              <dd className="font-medium">{typeof billingValues['billing.freeDailyMessages'] === 'number' ? `${billingValues['billing.freeDailyMessages']} 条` : '—'}</dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-2 py-3">
              <dt className="w-36 shrink-0 text-muted-foreground">用户收费倍率</dt>
              <dd className="font-medium">{typeof billingValues['billing.priceMultiplier'] === 'number' ? `${billingValues['billing.priceMultiplier']} / 1000` : '—'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">当前账号没有设置查看权限；免费额度与收费开关请在设置中心「计费额度」查看。</p>
        )}
      </AdminPanel>

      {dashboard && dashboard.costs.length > 0 && (
        <AdminPanel
          title={`按币种成本（${days} 天）`}
          description="不同币种不换算；未知成本单独计数，不并入估算金额。"
          badge={<Badge>{dashboard.costs.length} 种币种</Badge>}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {dashboard.costs.map(row => (
              <article key={row.currency} className="min-w-0 space-y-1 rounded-lg border border-border p-3 text-sm">
                <h3 className="font-medium">{row.currency} · 已知估算 {formatAmount(row.estimatedCost, row.currency)}</h3>
                <p className="break-words text-xs text-muted-foreground">
                  总调用 {row.calls} · 实际调用 {row.realCalls} · 已知成本 {row.knownCostCalls} · 未知成本 {row.unknownCostCalls}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  失败/取消 {row.failedCalls} · 模拟 {row.mockCalls} · 每千次 {row.costPerThousandCalls === null ? NOT_ENOUGH_SAMPLE : formatAmount(row.costPerThousandCalls, row.currency)}
                </p>
              </article>
            ))}
          </div>
        </AdminPanel>
      )}

      {dashboard && dashboard.budget.pricingUnpricedModels.length > 0 && (
        <AdminPanel
          title="启用模型缺少生效成本价"
          description="先为这些模型登记成本价，预算熔断才有依据；未知成本不会按 0 计算。"
          badge={<Badge variant="warning">{dashboard.budget.pricingUnpricedModels.length} 个模型</Badge>}
        >
          <ul className="list-inside list-disc break-words text-sm">
            {dashboard.budget.pricingUnpricedModels.map(model => <li key={model}>{model}</li>)}
          </ul>
        </AdminPanel>
      )}

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

      <ModelPriceDrawer
        key={editing?.id ?? 'none'}
        row={editing}
        canManage={canManage}
        busy={busy}
        onClose={() => setEditing(null)}
        onSubmit={(row, draft) => void savePrice(row, draft)}
      />
    </AdminPage>
  );
}
