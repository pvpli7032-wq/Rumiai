'use client';

import {Square} from 'lucide-react';
import type {CancelPolicy} from '@web/lib/hooks/use-quota';

/**
 * 生成中的取消行：按钮 + 计费提示（V3 表 16）。
 *
 * 提示只复述服务端规则，不在这里判断收费结果：
 * - 未开始生成（首个片段还没到）→ 取消不收费；
 * - RELEASE_ALWAYS → 不提示计费，用户读到一半取消不付费；
 * - CHARGE_WHEN_OUTPUT → 已开始生成则按已输出计费，当日免费取消次数用完时不再提括号。
 * 接口还没返回策略时不给任何计费结论，避免说错。
 */
export interface StreamCancelRowProps {
  cancelPolicy?: CancelPolicy;
  freeCancelRemaining?: number;
  /** 首个内容片段已送达用户。 */
  outputStarted: boolean;
  onCancel: () => void;
}

function billingHint(cancelPolicy: CancelPolicy | undefined, outputStarted: boolean, freeCancelRemaining: number | undefined): string {
  if (!outputStarted) return '还没开始生成，现在取消不计费。';
  if (cancelPolicy === 'RELEASE_ALWAYS') return '';
  if (cancelPolicy !== 'CHARGE_WHEN_OUTPUT') return '';
  const base = '已开始生成，取消将计费';
  return typeof freeCancelRemaining === 'number' && freeCancelRemaining > 0
    ? `${base}（今日还剩 ${freeCancelRemaining} 次免费取消）`
    : base;
}

export function StreamCancelRow({cancelPolicy, freeCancelRemaining, outputStarted, onCancel}: StreamCancelRowProps) {
  const hint = billingHint(cancelPolicy, outputStarted, freeCancelRemaining);
  return (
    <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center justify-between gap-2">
      <p className="min-w-0 flex-1 text-xs leading-5 text-zinc-400" role="status">
        {hint || '正在生成回复…'}
      </p>
      <button
        type="button"
        onClick={onCancel}
        aria-label="停止生成"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Square aria-hidden className="h-3.5 w-3.5" />
        停止生成
      </button>
    </div>
  );
}
