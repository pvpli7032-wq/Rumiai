'use client';
import {Button} from '@rumiai/ui';
import type {DisputeCaseDetail, DisputeChoice} from '@rumiai/contracts/disputes/types';
import {CHOICE_OPTIONS} from './shared';

function percent(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0;
}

/** 投票区：三种选择、票条、改票次数。本人不能投自己发起的案例。 */
export function VotePanel({
  detail,
  current,
  busy,
  onVote,
}: {
  detail: DisputeCaseDetail;
  current: DisputeChoice | null;
  busy: boolean;
  onVote: (choice: DisputeChoice) => void;
}) {
  const total = detail.tally.total;
  const closed = detail.closeStatus === 'CLOSED';
  const canChange = detail.myVote ? detail.myVote.remainingChanges > 0 : true;
  return (
    <section aria-label="投票" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">投票</h2>
        <p className="text-xs text-muted-foreground">共 {total} 票 · {detail.closeAtVotes > 0 ? `满 ${detail.closeAtVotes} 票提前结案` : '按截止时间结案'}</p>
      </div>
      <ul className="space-y-2">
        {CHOICE_OPTIONS.map(option => {
          const count = detail.tally[option.value];
          const mine = (current ?? detail.myVote?.choice) === option.value;
          return (
            <li key={option.value}>
              <button
                type="button"
                disabled={busy || !detail.canVote || Boolean(detail.myVote && !canChange && !mine)}
                onClick={() => onVote(option.value)}
                aria-pressed={mine}
                className={`w-full rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${mine ? 'border-brand bg-brand-soft' : 'border-border hover:bg-muted'}`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  <span>{option.label}{mine ? '（已投）' : ''}</span>
                  <span className="text-xs text-muted-foreground">{count} 票 · {percent(count, total)}%</span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-brand" style={{width: `${percent(count, total)}%`}} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {detail.isAuthor ? (
        <p className="text-xs text-muted-foreground">这是你自己发起的案例，不能投票。</p>
      ) : detail.myVote ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>已投「{CHOICE_OPTIONS.find(option => option.value === detail.myVote?.choice)?.label}」，还可改票 {detail.myVote.remainingChanges} 次。</span>
          {!closed && canChange ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onVote(detail.myVote!.choice === 'AUTHOR' ? 'SPLIT' : 'AUTHOR')}>换一个看法</Button> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{closed ? '投票已结束。' : '一人一票，改票次数按发起时的规则。'}</p>
      )}
    </section>
  );
}
