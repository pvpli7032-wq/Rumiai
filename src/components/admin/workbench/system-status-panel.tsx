'use client';

import {AdminPanel} from '@/components/admin/admin-page';
import {Badge, type BadgeVariant} from '@/components/ui/badge';
import type {SystemStatusItem} from './types';

const TONE: Record<SystemStatusItem['tone'], {label: string; variant: BadgeVariant}> = {
  ok: {label: '正常', variant: 'success'},
  warning: {label: '需留意', variant: 'warning'},
  danger: {label: '异常', variant: 'danger'},
  unknown: {label: '待确认', variant: 'neutral'},
};

/** 系统状态占三分之一：只显示 AI 可用性、最近备份与任务状态。 */
export function SystemStatusPanel({items}: {items: SystemStatusItem[]}) {
  return (
    <AdminPanel
      title="系统状态"
      description="只显示会影响今天运营的事项。"
      className="h-full"
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-border">
        {items.map(item => {
          const tone = TONE[item.tone];
          return (
            <li key={item.id} className="flex items-start gap-3 px-5 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{item.label}</span>
                <span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">{item.detail}</span>
              </span>
              <Badge variant={tone.variant} className="shrink-0">{tone.label}</Badge>
            </li>
          );
        })}
      </ul>
    </AdminPanel>
  );
}
