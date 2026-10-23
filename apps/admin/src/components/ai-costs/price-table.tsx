'use client';

import {DataTable} from '@admin/components/layout/data-table';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {contributionMargin, suggestPrice, type PricingBasis} from '@rumiai/contracts/ai/price-suggestion';
import {NOT_CONFIGURED, NOT_ENOUGH_SAMPLE, formatAmount, formatCoins, formatDateTime, type ModelPriceRow} from './types';

/** 成本换算口径摘要：汇率、目标毛利、最小样本、每币单价各一行，缺什么写什么。 */
export function PricingBasisNote({pricing}: {pricing: PricingBasis}) {
  const {exchange} = pricing;
  const rateText = exchange.rate !== null
    ? `${exchange.rate} 人民币/成本币${exchange.effectiveAt ? `（${formatDateTime(exchange.effectiveAt)} 起）` : ''}`
    : exchange.pendingRate !== null
      // 只登记了未来生效的汇率：生效前没有可用汇率，就照实说「待填写」，并把到点时间写出来。
      ? `待填写汇率（${exchange.pendingRate} 于 ${formatDateTime(exchange.pendingEffectiveAt)} 起生效，此前不换算毛利）`
      : '待填写汇率（不换算毛利）';
  // 多档套餐每币单价不同：展示区间，并把建议价实际用的那个单值口径写在括号里（V3 §218）。
  const range = pricing.coinUnitPriceRangeCny;
  const unitText = pricing.coinUnitPriceCny === null || !range
    ? '套餐人民币价格待配置'
    : range.min === range.max
      ? `¥${range.min.toFixed(4)}/币${pricing.coinUnitPriceNote ? `（${pricing.coinUnitPriceNote}）` : ''}`
      : `¥${range.min.toFixed(4)}～¥${range.max.toFixed(4)}/币（按套餐到手价折算；建议价按最优惠 ¥${pricing.coinUnitPriceCny.toFixed(4)}/币 计算${pricing.coinUnitPriceNote ? `，${pricing.coinUnitPriceNote}` : ''}）`;
  const items = [
    {label: '成本币汇率', value: rateText},
    {label: '目标毛利', value: pricing.targetMarginPercent === null ? '未设（不生成建议价）' : `${pricing.targetMarginPercent}%`},
    {label: '建议价最小样本', value: `${pricing.minSample} 条`},
    {label: '每币单价', value: unitText},
  ];
  return (
    <dl className="mb-4 grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
      {items.map(item => (
        <div key={item.label} className="min-w-0">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="break-words font-medium text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 模型价格表：收费币价、成本价、区间平均成本、预计收入、贡献毛利、建议币价。
 *
 * 两类价格永远分列；成本与收入只有在汇率登记之后才换算，没登记就只并列展示。
 * 建议币价四项缺一不出数字，缺哪项写哪项。
 */
export function PriceTable({rows, days, pricing, loading, error, busy, onRetry, onEdit}: {
  rows: ModelPriceRow[];
  days: number;
  pricing: PricingBasis;
  loading: boolean;
  error?: string;
  busy: boolean;
  onRetry: () => void;
  onEdit: (row: ModelPriceRow) => void;
}) {
  const exchangeConfigured = pricing.exchange.rate !== null;

  return (
    <DataTable
      rows={rows}
      getRowId={row => row.id}
      loading={loading}
      emptyTitle="还没有登记模型路由"
      emptyDescription="先在「模型服务」里登记模型，再回来定价。"
      error={error}
      onRetry={onRetry}
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
              {/* 来源是录价格时强制填的，之前只写不读；对账时要能一眼看到依据哪份报价。 */}
              <span className="mt-0.5 block break-words text-muted-foreground">来源：{row.costPrice.source || NOT_CONFIGURED}</span>
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
                    {item.calls < pricing.minSample
                      ? <span className="text-muted-foreground">{NOT_ENOUGH_SAMPLE}（{item.calls}/{pricing.minSample} 次）</span>
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
            if (usage.calls < pricing.minSample) return <span className="text-xs text-muted-foreground">{NOT_ENOUGH_SAMPLE}（{usage.calls}/{pricing.minSample} 次）</span>;
            return <span className="text-xs">{formatCoins(row.coinPrice.coinsPerReply * usage.calls)}</span>;
          },
        },
        {
          id: 'margin',
          header: '贡献毛利',
          width: '150px',
          cell: row => {
            if (!exchangeConfigured) {
              return <span className="text-xs text-muted-foreground" title="币与成本币之间没有登记换算口径，不展示推算毛利">{NOT_CONFIGURED}</span>;
            }
            const outcome = contributionMargin({sample: sampleOf(row), coinPriceCoins: row.coinPrice?.coinsPerReply ?? null, basis: pricing});
            if (outcome.kind === 'missing') {
              return <span className="block text-xs text-muted-foreground" title={outcome.reasons.join('；')}>{outcome.reasons[0]}</span>;
            }
            return (
              <span className="block text-xs">
                <span className="block font-medium text-foreground">{outcome.percent.toFixed(1)}%</span>
                <span className="mt-0.5 block text-muted-foreground">收入 ¥{outcome.revenueCny.toFixed(4)} · 成本 ¥{outcome.costCny.toFixed(4)}</span>
              </span>
            );
          },
        },
        {
          id: 'suggested',
          header: '建议币价',
          width: '190px',
          cell: row => {
            const outcome = suggestPrice({sample: sampleOf(row), basis: pricing});
            if (outcome.kind === 'missing') {
              return <span className="block break-words text-xs text-muted-foreground" title={outcome.reasons.join('；')}>{outcome.reasons.join('；')}</span>;
            }
            const current = row.coinPrice?.coinsPerReply ?? null;
            const gap = current === null ? null : outcome.coins - current;
            return (
              <span className="block text-xs">
                <span className="block font-medium text-foreground">{formatCoins(outcome.coins)}/条</span>
                <span className="mt-0.5 block text-muted-foreground">
                  目标收入 ¥{outcome.revenueCny.toFixed(4)}
                  {gap === null ? '' : gap === 0 ? ' · 与现价一致' : ` · 现价${gap > 0 ? '偏低' : '偏高'} ${Math.abs(gap)} 币`}
                </span>
              </span>
            );
          },
        },
        {
          id: 'actions',
          header: '操作',
          width: '100px',
          cell: row => (
            <Button size="sm" variant="outline" aria-label={`编辑价格 ${row.displayName}`} disabled={busy} onClick={() => onEdit(row)}>
              编辑
            </Button>
          ),
        },
      ]}
    />
  );
}

/** 建议价与毛利都用区间内第一条用量样本，与「预计收入」保持同一个口径。 */
function sampleOf(row: ModelPriceRow) {
  const usage = row.usage[0];
  if (!usage) return null;
  return {currency: usage.currency, calls: usage.calls, knownCostCalls: usage.knownCostCalls, estimatedCost: usage.estimatedCost};
}
