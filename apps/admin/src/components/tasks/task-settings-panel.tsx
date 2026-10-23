'use client';

import {ArrowUpRight, ChevronDown, ChevronRight} from 'lucide-react';
import Link from 'next/link';
import {useId, useState} from 'react';
import {AdminNotice, AdminPanel} from '@admin/components/admin-page';
import {TASK_SETTING_KEYS, TASK_SETTING_LABELS, type TaskSettingKey} from './types';

/**
 * 高级设置：频率、批次与重试。
 *
 * V3 §16 的「同一项只有一个编辑位置」——这些键的编辑位置在设置中心「增长玩法」，
 * 这里只读展示当前生效值并给出跳转，避免出现第二套输入框。
 */
export interface TaskSettingsPanelProps {
  values: Partial<Record<TaskSettingKey, unknown>> | null;
  canReadSettings: boolean;
  error: string;
  loading: boolean;
}

function readValue(values: Partial<Record<TaskSettingKey, unknown>>, key: TaskSettingKey): string {
  const value = values[key];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value;
  return '—';
}

export function TaskSettingsPanel({values, canReadSettings, error, loading}: TaskSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <AdminPanel
      title="高级设置"
      description="任务频率、每批处理数与失败重试上限；默认折叠，日常不需要改。"
      actions={
        <Link
          href="/admin/settings"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          去设置中心修改
          <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
      flush
    >
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-2 px-5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {open ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
        频率、批次与重试
      </button>
      {open && (
        <div id={panelId} className="space-y-3 border-t border-border p-5">
          {!canReadSettings && (
            <AdminNotice tone="info" title="当前账号没有设置查看权限" description="任务参数只在设置中心展示；这里给不出数值，也不会显示猜测值。" />
          )}
          {canReadSettings && error && <AdminNotice tone="error" title={error} />}
          {canReadSettings && !error && loading && <AdminNotice tone="loading" title="正在读取任务参数…" />}
          {canReadSettings && !error && !loading && values && (
            <dl className="divide-y divide-border">
              {TASK_SETTING_KEYS.map(key => (
                <div key={key} className="flex flex-col gap-0.5 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-4">
                  <dt className="shrink-0 text-muted-foreground sm:w-36">{TASK_SETTING_LABELS[key].label}</dt>
                  <dd className="min-w-0 break-words font-medium text-foreground">
                    {readValue(values, key)} {TASK_SETTING_LABELS[key].unit}
                  </dd>
                  <dd className="min-w-0 break-all text-xs text-muted-foreground sm:ml-auto">{key}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            任务本身持久化在 background_tasks 表：kind 与 subjectId 唯一、带租约、失败按上限重试后置为已失败。手动执行与巡检走同一套租约与重试。
          </p>
        </div>
      )}
    </AdminPanel>
  );
}
