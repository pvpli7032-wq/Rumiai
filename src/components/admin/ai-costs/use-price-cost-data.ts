'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {apiFetch} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {
  pickEffective,
  type ChargePage,
  type CoinPriceItem,
  type CoinPriceView,
  type CostDashboard,
  type CostPriceView,
  type ModelPriceRow,
} from './types';

/** 免费额度与收费开关：只读摘要，编辑入口在设置中心。 */
const BILLING_KEYS = ['billing.chargingEnabled', 'billing.freeDailyMessages', 'billing.priceMultiplier'] as const;

type BillingSettingRow = {key: string; value: unknown};

/**
 * 「价格与成本」页的数据读取。
 *
 * 三个接口各管一件事：收费币价（含换算口径）、供应商成本价、已计量成本；
 * 费用单与计费设置各有独立权限，缺权限就置空，不把「没权限」显示成「没有数据」。
 */
export function usePriceCostData(options: {sessionActive: boolean; canRead: boolean; canReadBilling: boolean; canReadSettings: boolean}) {
  const {sessionActive, canRead, canReadBilling, canReadSettings} = options;
  // 工作台指标卡会带 ?days= 进来，初值从 URL 读；非法值退回 7 天。
  const [days, setDays] = useState(() => {
    if (typeof window === 'undefined') return 7;
    const value = Number(new URLSearchParams(window.location.search).get('days'));
    return [1, 7, 30, 90].includes(value) ? value : 7;
  });
  const [coinView, setCoinView] = useState<CoinPriceView | null>(null);
  const [costView, setCostView] = useState<CostPriceView | null>(null);
  const [dashboard, setDashboard] = useState<CostDashboard | null>(null);
  const [charges, setCharges] = useState<ChargePage | null>(null);
  const [billingValues, setBillingValues] = useState<Partial<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);

  const load = useCallback(async () => {
    if (!sessionActive) return;
    setLoading(true);
    setError('');
    try {
      const [coins, prices, costs] = await Promise.all([
        apiFetch<CoinPriceView>(API.admin.coinPrices, {credentials: 'same-origin', cache: 'no-store'}),
        apiFetch<CostPriceView>(API.admin.ai.prices, {credentials: 'same-origin', cache: 'no-store'}),
        apiFetch<CostDashboard>(API.admin.ai.costs + `?days=${days}`, {credentials: 'same-origin', cache: 'no-store'}),
      ]);
      setCoinView(coins);
      setCostView(prices);
      setDashboard(costs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '价格与成本数据加载失败。');
    } finally {
      setLoading(false);
    }
  }, [sessionActive, days]);

  useEffect(() => {
    setCoinView(null);
    setCostView(null);
    setDashboard(null);
    if (sessionActive && canRead) void load();
  }, [sessionActive, canRead, days, refreshKey, load]);

  // 收入估算：只取已结算费用单的币数样本，不把币硬折成币种金额。
  useEffect(() => {
    if (!sessionActive || !canReadBilling) { setCharges(null); return; }
    const controller = new AbortController();
    void apiFetch<ChargePage>(API.admin.billingCharges(new URLSearchParams({status: 'SETTLED', limit: '50'}).toString()), {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(data => { if (!controller.signal.aborted) setCharges(data); })
      .catch(() => { if (!controller.signal.aborted) setCharges(null); });
    return () => controller.abort();
  }, [sessionActive, canReadBilling, refreshKey]);

  // 免费额度与收费开关：只读摘要 + 跳转，设置中心是唯一编辑位置。
  useEffect(() => {
    if (!sessionActive || !canReadSettings) { setBillingValues(null); return; }
    const controller = new AbortController();
    void apiFetch<{values: BillingSettingRow[]}>(API.admin.settings + '?group=billing', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal})
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
  }, [sessionActive, canReadSettings, refreshKey]);

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
    const settled = charges?.items ?? [];
    return {
      costRows: costs,
      unknownCalls: costs.reduce((sum, row) => sum + row.unknownCostCalls, 0),
      settledCount: settled.length,
      settledCoins: settled.reduce((sum, row) => sum + row.coins, 0),
    };
  }, [dashboard, charges]);

  return {
    days, setDays, coinView, costView, dashboard, charges, billingValues,
    loading, error, setError, refreshKey, refresh, rows, summary,
  };
}
