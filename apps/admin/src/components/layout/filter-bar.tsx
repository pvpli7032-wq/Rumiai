'use client';

import {RotateCcw} from 'lucide-react';
import type {ReactNode} from 'react';
import {Button} from '@rumiai/ui/button';
import {cn} from '@rumiai/ui/cn';

/**
 * 列表页筛选条：控件区 + 右侧动作区。
 *
 * 手机端控件上下排列，宽屏并排换行；整个筛选条不设固定宽度，
 * 内部控件用 `min-w-0` 约束，避免长下拉把整页撑出横向滚动。
 */
export interface FilterBarProps {
  children: ReactNode;
  /** 右侧动作：导出、新建等。 */
  actions?: ReactNode;
  /** 传了才显示「重置筛选」。 */
  onReset?: () => void;
  resetLabel?: string;
  className?: string;
  'aria-label'?: string;
}

export function FilterBar({
  children,
  actions,
  onReset,
  resetLabel = '重置筛选',
  className,
  'aria-label': ariaLabel = '筛选',
}: FilterBarProps) {
  return (
    <div
      role="search"
      aria-label={ariaLabel}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3',
        'sm:flex-row sm:flex-wrap sm:items-center',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
      {(onReset || actions) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto">
          {onReset && (
            <Button variant="ghost" size="sm" onClick={onReset} leadingIcon={<RotateCcw aria-hidden className="h-3.5 w-3.5" />}>
              {resetLabel}
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
