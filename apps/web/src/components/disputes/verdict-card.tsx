import {Badge} from '@rumiai/ui';
import type {DisputeVerdict} from '@rumiai/contracts/disputes/types';

/**
 * 结案结果。模型回应与「系统说明」明确分开：兜底文案不会读起来像角色判词。
 */
export function VerdictCard({verdict, closeStatus}: {verdict: DisputeVerdict | null; closeStatus: string}) {
  if (!verdict) {
    return (
      <section aria-label="结案结果" className="rounded-xl border border-dashed border-border p-4">
        <h2 className="text-base font-semibold">结案结果</h2>
        <p className="mt-1 text-sm text-muted-foreground">{closeStatus === 'CLOSING' ? '正在结案，结果稍后出现在这里。' : '投票结束后自动结案，结果会出现在这里。'}</p>
      </section>
    );
  }
  const fallback = verdict.status === 'FALLBACK';
  return (
    <section aria-label="结案结果" className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">结案结果</h2>
        <Badge variant={fallback ? 'warning' : 'brand'}>{fallback ? '系统说明' : '角色回应'}</Badge>
        <span className="text-xs text-muted-foreground">共 {verdict.outcome.tally.total} 票</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{verdict.text}</p>
      {fallback ? <p className="text-xs text-muted-foreground">本次没有生成角色回应，以上是计票说明，不是 AI 判词。</p> : null}
    </section>
  );
}
