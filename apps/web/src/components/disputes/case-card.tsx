import Link from 'next/link';
import {Badge} from '@rumiai/ui';
import type {DisputeCaseSummary} from '@rumiai/contracts/disputes/types';
import {caseStateLabel, formatTime, remainingText} from './shared';

/** 列表项：诉求 + 票条 + 摘录预览。整张卡片是链接，不做行内编辑。 */
export function DisputeCaseCard({item, locale}: {item: DisputeCaseSummary; locale: string}) {
  const total = item.tally.total;
  return (
    <li className="min-w-0">
      <Link href={`/${locale}/disputes/${item.id}`} className="block min-w-0 space-y-3 rounded-xl border border-border p-4 transition-colors hover:border-brand/60">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={item.closeStatus === 'OPEN' ? 'brand' : item.closeStatus === 'CLOSED' ? 'success' : 'warning'}>{caseStateLabel(item)}</Badge>
          <span>{item.author.name} 发起</span>
          {item.character ? <span>· 与「{item.character.name}」的对话</span> : null}
        </div>
        <p className="whitespace-pre-wrap break-words text-base font-medium leading-snug">{item.claim}</p>
        <div className="space-y-1">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            {(['AUTHOR', 'OTHER', 'SPLIT'] as const).map((choice, index) => (
              <span key={choice} className={['bg-brand', 'bg-emerald-500', 'bg-amber-500'][index]} style={{width: total ? `${(item.tally[choice] / total) * 100}%` : '0%'}} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">我 {item.tally.AUTHOR} · TA {item.tally.OTHER} · 各打五十大板 {item.tally.SPLIT} · 共 {total} 票</p>
        </div>
        {item.excerpt.length ? <p className="line-clamp-2 break-words text-sm text-muted-foreground">摘录 {item.excerptCount} 条：{item.excerpt.map(message => message.content).join(' / ')}</p> : null}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>{item.commentCount} 条评论</span>
          <span>{item.closeStatus === 'OPEN' ? remainingText(item.deadlineAt) : `截止 ${formatTime(item.deadlineAt)}`}</span>
          {item.myVote ? <span>我投了「{item.myVote.choice === 'AUTHOR' ? '我更有理' : item.myVote.choice === 'OTHER' ? 'TA 更有理' : '各打五十大板'}」</span> : null}
        </div>
      </Link>
    </li>
  );
}
