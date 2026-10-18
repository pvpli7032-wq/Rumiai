import type { FinanceReport } from '@/lib/payments/reconciliation-service';

const percentage = (value: number | null) => value === null ? '暂无样本' : `${(value * 100).toFixed(2)}%`;

export function PaymentValidationMetrics({ metrics, costs }: { metrics: FinanceReport['validationMetrics']; costs: FinanceReport['aiCosts'] }) {
  return <section className="space-y-3 rounded-xl border p-4">
    <h2 className="font-bold">付费验证指标</h2>
    <p>新注册用户付费率：{percentage(metrics.newUserPaymentRate)}（{metrics.payingNewUsers} / {metrics.registeredUsers} 人）</p>
    <p>付款订单退款率：{percentage(metrics.paidOrderRefundRate)}（{metrics.refundedCohortOrders} / {metrics.paidOrderCount} 笔）</p>
    <p className="text-sm text-muted-foreground">付费率仅统计所选期间注册且付款的用户，每人计一次。退款率以所选期间付款的订单为分母，已完成整单退款为分子；退款待核对不算完成。</p>
    {costs.map(row => <p key={row.currency}>{row.currency} · 每千次 AI 调用成本：{row.costPerThousandCalls === null ? '无法计算' : row.costPerThousandCalls.toFixed(6)}（{row.realCalls} 次非模拟调用）</p>)}
    {!costs.length && <p>每千次 AI 调用成本：暂无调用样本。</p>}
    <p className="text-sm text-muted-foreground">调用包含发送、重生成、失败及取消，不等于完成对话。存在未知成本时不计算；各币种不换算。</p>
    <p>毛利率：无法计算（尚无渠道手续费、结算和完整人民币成本）</p>
    <p className="text-sm text-muted-foreground">指标来自本地留存记录，不能替代真实渠道和小范围付费验收。</p>
  </section>;
}
