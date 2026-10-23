'use client';

import Link from 'next/link';
import {ArrowRight} from 'lucide-react';
import {AdminPanel} from '@admin/components/admin-page';
import {Badge} from '@rumiai/ui/badge';
import type {TodoItem} from './types';

/** 待办占第二行三分之二：按实际数量列出待审角色、未处理举报、待处理退款。 */
export function TodoPanel({items}: {items: TodoItem[]}) {
  const pending = items.filter(item => (item.count ?? 0) > 0).length;
  return (
    <AdminPanel
      title="待办"
      description="今天需要处理的事项；点击进入对应列表。"
      badge={<Badge variant={pending > 0 ? 'warning' : 'neutral'}>{pending > 0 ? `${pending} 项待处理` : '暂无待办'}</Badge>}
      className="h-full"
      bodyClassName="p-0"
    >
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">暂无数据</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map(item => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                </span>
                <span className="shrink-0 text-right">
                  {item.count === null ? (
                    <span className="text-xs text-muted-foreground">暂时算不出</span>
                  ) : (
                    <span className="text-lg font-semibold tabular-nums text-foreground">{item.count}</span>
                  )}
                </span>
                <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}
