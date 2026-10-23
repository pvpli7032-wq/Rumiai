'use client';

import Link from 'next/link';
import {AdminPanel} from '@admin/components/admin-page';
import {Badge} from '@rumiai/ui/badge';
import {formatAmount, type TaskBudgetRow} from './types';

/**
 * AI 任务预算（V3 表 9 / §22）。
 *
 * 任务预算按任务分别设，单位是成本币，只在设置中心「计费额度」里改，这里只展示
 * 今日已用与上限。达到上限只暂停该任务，其他玩法照常，消耗仍计入全站预算；
 * 未填写表示不额外限制，显示「未设上限」，不能写成 0。
 */
export interface TaskBudgetPanelProps {
  rows: TaskBudgetRow[];
}

/** 一个任务的今日已用：多币种分行，未知成本单独标注，不并入金额。 */
function UsageText({row}: {row: TaskBudgetRow}) {
  if (row.usage.length === 0) return <span className="text-muted-foreground">今日暂无调用</span>;
  return (
    <span className="space-y-0.5">
      {row.usage.map(item => (
        <span key={item.currency} className="block break-words">
          {formatAmount(item.knownCost, item.currency)}
          {item.unknownCalls > 0 && <span className="text-muted-foreground">（{item.unknownCalls} 次成本待核对）</span>}
        </span>
      ))}
    </span>
  );
}

/** 上限的币种跟今日用量一致；还没有用量时只写数值，不猜币种。 */
function limitText(row: TaskBudgetRow): string {
  if (row.limit === null) return '未设上限';
  const currency = row.usage[0]?.currency;
  return currency ? formatAmount(row.limit, currency) : `${row.limit} 成本币`;
}

export function TaskBudgetPanel({rows}: TaskBudgetPanelProps) {
  const unlimited = rows.filter(row => row.limit === null).length;
  return (
    <AdminPanel
      title="AI 任务预算"
      description="每个任务单独设每日预算；达到上限只暂停该任务，聊天与其他玩法不受影响，消耗仍计入全站预算。"
      badge={unlimited > 0 ? <Badge variant="outline">{unlimited} 个任务未设上限</Badge> : <Badge variant="success">全部已设上限</Badge>}
      actions={
        <Link
          href="/admin/settings"
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          去设置中心修改
        </Link>
      }
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map(row => (
          <article key={row.taskType} className="min-w-0 space-y-1 rounded-2xl border border-border/80 bg-gradient-to-br from-card to-muted/20 p-4 text-sm shadow-sm">
            <h3 className="font-medium">{row.label}</h3>
            <p className="break-words text-xs text-muted-foreground">今日已用：<UsageText row={row} /></p>
            <p className="break-words text-xs text-muted-foreground">
              每日预算：{limitText(row)}
              {row.taskType === 'mirrorAnonymous' && row.limit === null && <span>（匿名入口关闭）</span>}
            </p>
          </article>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        未设上限的任务不额外限制；他眼中的你匿名预算未填写时匿名入口关闭并提示待设置。任务预算与全站预算分开判断，两者都通过才会放行新调用。
      </p>
    </AdminPanel>
  );
}
