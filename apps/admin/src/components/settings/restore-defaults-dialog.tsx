'use client';

import {RotateCcw} from 'lucide-react';
import {Button} from '@rumiai/ui/button';
import {Dialog} from '@rumiai/ui/dialog';
import type {JsonValue, SettingDefinition} from '@rumiai/contracts/settings/types';
import {formatSettingValue} from './format';

/**
 * 「恢复默认」的影响预览（V3 §16：恢复默认需明确将变更哪些值，不自动立刻提交）。
 *
 * 弹窗只把默认值写回草稿；真正的提交仍然要点底部保存栏的「保存本页」。
 */
export interface RestoreDefaultsDialogProps {
  open: boolean;
  /** 会被改回默认值的字段（已经排除了本来就是默认值的项）。 */
  items: {definition: SettingDefinition; current: JsonValue}[];
  onCancel: () => void;
  /** 仅写入草稿，不提交。 */
  onConfirm: () => void;
  scopeLabel: string;
}

export function RestoreDefaultsDialog({open, items, onCancel, onConfirm, scopeLabel}: RestoreDefaultsDialogProps) {
  if (!open) return null;

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`恢复${scopeLabel}的默认值`}
      description="以下字段会被改回登记默认值。点「写入草稿」后仍需在底部保存栏点「保存本页」才会生效。"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={onConfirm} leadingIcon={<RotateCcw aria-hidden className="h-4 w-4" />}>写入草稿</Button>
        </>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">当前没有可以恢复的字段：这些设置已经是登记默认值。</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map(({definition, current}) => (
            <li key={definition.key} className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span className="min-w-0 font-medium text-foreground">{definition.label}</span>
              <span className="min-w-0 break-words text-xs text-muted-foreground sm:text-right">
                {formatSettingValue(definition, current)} → {formatSettingValue(definition, definition.default)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
