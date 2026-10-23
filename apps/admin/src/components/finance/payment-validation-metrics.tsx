import type { FinanceReport } from '@rumiai/contracts/admin/finance';
import { AdminPanel } from '@admin/components/admin-page';

const percentage = (value: number | null) => value === null ? '暂无样本' : `${(value * 100).toFixed(2)}%`;

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums leading-none text-foreground">{value}</dd>
      {hint && <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PaymentValidationMetrics({ metrics, costs }: { metrics: FinanceReport['validationMetrics']; costs: FinanceReport['aiCosts'] }) {
  return (
    <AdminPanel title="付费验证指标" description="指标来自本地留存记录，不能替代真实渠道和小范围付费验收。">
      <div className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <MetricTile
            label="新注册用户付费率"
            value={percentage(metrics.newUserPaymentRate)}
            hint={`${metrics.payingNewUsers} / ${metrics.registeredUsers} 人 · 仅统计所选期间注册且付款的用户，每人计一次`}
          />
          <MetricTile
            label="付款订单退款率"
            value={percentage(metrics.paidOrderRefundRate)}
            hint={`${metrics.refundedCohortOrders} / ${metrics.paidOrderCount} 笔 · 以所选期间付款的订单为分母，已完成整单退款为分子；退款待核对不算完成`}
          />
          <MetricTile label="毛利率" value="无法计算" hint="尚无渠道手续费、结算和完整人民币成本" />
          <MetricTile
            label="每千次 AI 调用成本"
            value={costs.length ? '' : '暂无调用样本'}
            hint="调用包含发送、重生成、失败及取消，不等于完成对话；存在未知成本时不计算，各币种不换算"
          />
        </dl>
        {costs.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {costs.map(row => (
              <li key={row.currency} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-medium">{row.currency}</span>
                <span className="tabular-nums text-muted-foreground">
                  {row.costPerThousandCalls === null ? '无法计算' : row.costPerThousandCalls.toFixed(6)} · {row.realCalls} 次非模拟调用
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPanel>
  );
}
