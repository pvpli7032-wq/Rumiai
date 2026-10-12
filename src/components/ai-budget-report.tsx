import type { FinanceReport } from '@/lib/payments/reconciliation-service';

export function AiBudgetReport({ report }: { report: FinanceReport['aiBudget'] }) {
  return <section className="space-y-2 rounded-xl border p-4">
    <h2 className="font-bold">当日 AI 预算提示</h2>
    {report.status === 'disabled' && <p>尚未配置每日成本预算。</p>}
    {report.status === 'invalid' && <p role="alert" className="text-red-400">每日成本预算配置无效，请检查服务端配置。</p>}
    {report.status === 'enabled' && <>
      {Object.entries(report.budgets).map(([currency, limits]) => <p key={currency}>{currency} · 全站预算 {limits.site ?? '未设置'} · 每账号预算 {limits.user ?? '未设置'}</p>)}
      {!report.alerts.length && <p>已知成本尚未达到已配置的预算。</p>}
      {report.alerts.map(row => <p role="alert" className="break-all text-orange-400" key={`${row.scope}:${row.currency}:${row.userId}`}>
        {row.scope === 'site' ? '全站' : `账号 ${row.userId}`} · {row.currency} 已知成本 {row.knownCost.toFixed(6)}，达到预算 {row.budget}
      </p>)}
      {report.alertsTruncated && <p>提示超过 100 条，仅展示前 100 条。</p>}
      {report.unknownCostCalls > 0 && <p role="alert">当日 {report.unknownCostCalls} 次调用成本未知，无法确认是否超预算。</p>}
      {!!report.unbudgetedCurrencies.length && <p>未设置预算的币种：{report.unbudgetedCurrencies.join('、')}</p>}
    </>}
    <p className="text-sm text-muted-foreground">按 UTC 当日统计，与上方统计范围独立。刷新报告时核对，不自动停用模型或发送外部通知。</p>
  </section>;
}
