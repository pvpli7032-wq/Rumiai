'use client';

import {ChevronDown, ChevronRight} from 'lucide-react';
import {useId, useState, type ReactNode} from 'react';
import {cn} from '@/components/ui/cn';

/**
 * 设置分组卡片：常用字段直接展示，高级字段默认折叠（V3 §16）。
 * 字段行由调用方渲染，这里只负责标题、说明、操作与折叠行为。
 */
export interface SettingsGroupProps {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  /** 常用字段。 */
  children: ReactNode;
  /** 折叠区字段；为空时不渲染折叠按钮。 */
  advanced?: ReactNode;
  advancedCount?: number;
  advancedLabel?: string;
  className?: string;
}

export function SettingsGroup({
  title,
  description,
  badge,
  actions,
  children,
  advanced,
  advancedCount,
  advancedLabel = '高级设置',
  className,
}: SettingsGroupProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', className)}>
      <header className="flex flex-col gap-3 border-b border-border bg-muted/40 px-4 py-4 md:flex-row md:items-start md:justify-between md:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {badge}
          </div>
          {description && <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>

      <div className="divide-y divide-border px-4 md:px-5">{children}</div>

      {advanced && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:px-5"
          >
            {open ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
            {advancedLabel}
            {typeof advancedCount === 'number' && <span className="text-xs font-normal">（{advancedCount} 项）</span>}
          </button>
          {open && (
            <div id={panelId} className="divide-y divide-border border-t border-border px-4 md:px-5">
              {advanced}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
