'use client';

import {Save, Undo2} from 'lucide-react';
import type {ReactNode} from 'react';
import {Button} from '@rumiai/ui/button';
import {cn} from '@rumiai/ui/cn';

/**
 * 底部保存栏：有未保存修改时才出现（V3 §16）。
 *
 * 用 sticky 而不是 fixed，贴的是后台工作区自己的滚动容器，
 * 因此不会盖住左侧导航，也不会在窄屏产生横向溢出。
 */
export interface SaveBarProps {
  visible: boolean;
  dirtyCount: number;
  saving?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
  onDiscard: () => void;
  onSave: () => void;
  saveLabel?: string;
  discardLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function SaveBar({
  visible,
  dirtyCount,
  saving = false,
  error,
  hint,
  onDiscard,
  onSave,
  saveLabel = '保存本页',
  discardLabel = '放弃修改',
  disabled = false,
  className,
}: SaveBarProps) {
  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="保存栏"
      className={cn(
        'sticky bottom-0 z-20 mt-2 min-w-0 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-[0_-6px_16px_-12px_rgba(0,0,0,0.4)] backdrop-blur',
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs leading-5 text-muted-foreground">
          <p className="font-medium text-foreground">有 {dirtyCount} 项修改尚未保存</p>
          {hint && <p className="break-words">{hint}</p>}
          {error && <p role="alert" className="break-words text-destructive">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" onClick={onDiscard} disabled={saving} leadingIcon={<Undo2 aria-hidden className="h-4 w-4" />}>
            {discardLabel}
          </Button>
          <Button onClick={onSave} loading={saving} disabled={disabled} leadingIcon={<Save aria-hidden className="h-4 w-4" />}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
