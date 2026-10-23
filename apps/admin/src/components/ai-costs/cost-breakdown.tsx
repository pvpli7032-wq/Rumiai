'use client';

import {AdminPanel} from '@admin/components/admin-page';
import {Badge} from '@rumiai/ui/badge';
import {NOT_ENOUGH_SAMPLE, formatAmount, type CostRow} from './types';

/** 按币种成本：不同币种不换算，未知成本单独计数，不并入估算金额。 */
export function CostCurrencyPanel({rows, days}: {rows: CostRow[]; days: number}) {
  if (rows.length === 0) return null;
  return (
    <AdminPanel
      title={`按币种成本（${days} 天）`}
      description="不同币种不换算；未知成本单独计数，不并入估算金额。"
      badge={<Badge>{rows.length} 种币种</Badge>}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map(row => (
          <article key={row.currency} className="min-w-0 space-y-1 rounded-2xl border border-border/80 bg-gradient-to-br from-card to-muted/20 p-4 text-sm shadow-sm">
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
  );
}

/** 启用模型缺少生效成本价：预算熔断没有依据，未知成本不会按 0 计算。 */
export function UnpricedModelsPanel({models}: {models: string[]}) {
  if (models.length === 0) return null;
  return (
    <AdminPanel
      title="启用模型缺少生效成本价"
      description="先为这些模型登记成本价，预算熔断才有依据；未知成本不会按 0 计算。"
      badge={<Badge variant="warning">{models.length} 个模型</Badge>}
    >
      <ul className="list-inside list-disc break-words text-sm">
        {models.map(model => <li key={model}>{model}</li>)}
      </ul>
    </AdminPanel>
  );
}
