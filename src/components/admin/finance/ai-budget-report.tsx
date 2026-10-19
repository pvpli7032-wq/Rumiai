import type { FinanceReport } from '@/lib/payments/reconciliation-service';
import { AdminNotice, AdminPanel } from '@/components/admin/admin-page';

export function AiBudgetReport({ report }: { report: FinanceReport['aiBudget'] }) {
  const problems: string[] = [];
  if (report.status === 'invalid') problems.push('每日成本预算配置无效，请检查服务端配置。');
  if (report.circuitBreaker === 'invalid') problems.push('自动熔断开关无效，新调用将被拒绝，请检查服务端配置。');
  if (report.circuitBreaker === 'enabled' && report.status !== 'enabled') problems.push('已开启自动熔断，但预算未配置或无效，新调用将被拒绝。');
  if (report.circuitBreaker === 'enabled' && !report.pricingConfigured) problems.push('已开启自动熔断，但模型单价未配置或无效，新调用将被拒绝。');

  const breakerHint =
    report.circuitBreaker === 'enabled'
      ? '已开启自动熔断：达到已知成本阈值或已结束调用费用未知时暂停新调用；已接纳的请求继续执行，可能越过阈值。'
      : report.circuitBreaker === 'invalid'
        ? '自动熔断配置无效，拒绝新调用。'
        : '当前只显示预算提示，未开启自动熔断。';

  return (
    <AdminPanel
      title="当日 AI 预算提示"
      description={`按 UTC 当日统计，与上方统计范围独立。${breakerHint}不发送外部通知。`}
    >
      <div className="space-y-3 text-sm">
        {report.status === 'disabled' && <AdminNotice tone="info" title="尚未配置每日成本预算。" />}
        {report.status === 'enabled' && report.alerts.length > 0 && (
          <AdminNotice tone="warning" title={`${report.alerts.length} 项预算已达阈值`} description="同一天内重复出现的账号只会列出一次。" />
        )}
        {problems.map(text => (
          <AdminNotice key={text} tone="error" title={text} />
        ))}
        {report.status === 'enabled' && report.unknownCostCalls > 0 && (
          <AdminNotice tone="warning" title={`当日 ${report.unknownCostCalls} 次调用成本未知`} description="无法确认这部分调用是否越过预算。" />
        )}
        {report.status === 'enabled' && Object.keys(report.budgets).length > 0 && (
          <dl className="divide-y divide-border rounded-lg border border-border">
            {Object.entries(report.budgets).map(([currency, limits]) => (
              <div key={currency} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <dt className="font-medium">{currency}</dt>
                <dd className="text-sm tabular-nums text-muted-foreground">
                  全站预算 {limits.site ?? '未设置'} · 每账号预算 {limits.user ?? '未设置'}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {report.status === 'enabled' && report.alerts.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {report.alerts.map(row => (
              <li key={`${row.scope}:${row.currency}:${row.userId}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-medium">{row.scope === 'site' ? '全站' : `账号 ${row.userId}`}</span>
                <span className="break-all tabular-nums text-muted-foreground">
                  {row.currency} 已知成本 {row.knownCost.toFixed(6)}，达到预算 {row.budget}
                </span>
              </li>
            ))}
          </ul>
        )}
        {report.status === 'enabled' && !report.alerts.length && !problems.length && (
          <AdminNotice tone="success" title="已知成本尚未达到已配置的预算。" />
        )}
        {report.status === 'enabled' && report.alertsTruncated && <p className="text-xs text-muted-foreground">提示超过 100 条，仅展示前 100 条。</p>}
        {report.status === 'enabled' && !!report.unbudgetedCurrencies.length && (
          <p className="text-xs text-muted-foreground">未设置预算的币种：{report.unbudgetedCurrencies.join('、')}</p>
        )}
      </div>
    </AdminPanel>
  );
}
