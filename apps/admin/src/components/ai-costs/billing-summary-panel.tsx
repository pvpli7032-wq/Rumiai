'use client';

import Link from 'next/link';
import {AdminPanel} from '@admin/components/admin-page';
import {Badge} from '@rumiai/ui/badge';

/**
 * 免费额度与收费开关的只读摘要。
 *
 * 规则只有一份，编辑入口在设置中心「计费额度」；价格页不重复提供编辑，避免两处改同一个键。
 */
const ROWS = [
  {key: 'billing.chargingEnabled', label: '聊天收费', format: (value: unknown) => (value === true ? '已开启' : '关闭')},
  {key: 'billing.freeDailyMessages', label: '每日免费回复', format: (value: unknown) => (typeof value === 'number' ? `${value} 条` : '—')},
  {key: 'billing.priceMultiplier', label: '用户收费倍率', format: (value: unknown) => (typeof value === 'number' ? `${value} / 1000` : '—')},
] as const;

export function BillingSummaryPanel({values}: {values: Partial<Record<string, unknown>> | null}) {
  return (
    <AdminPanel
      title="免费额度与收费开关"
      description="规则只有一份，在设置中心「计费额度」里修改；这里只显示当前值。"
      badge={values ? undefined : <Badge variant="outline">无设置查看权限</Badge>}
      actions={
        <Link
          href="/admin/settings"
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          去设置中心
        </Link>
      }
    >
      {values ? (
        <dl className="divide-y divide-border text-sm">
          {ROWS.map(row => (
            <div key={row.key} className="flex flex-wrap items-baseline gap-2 py-3">
              <dt className="w-36 shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="font-medium">{row.format(values[row.key])}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">当前账号没有设置查看权限；免费额度与收费开关请在设置中心「计费额度」查看。</p>
      )}
    </AdminPanel>
  );
}
