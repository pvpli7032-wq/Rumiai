'use client';

import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { Textarea } from '@rumiai/ui/textarea';

export type ReviewCharacter = { id: string; name: string; tagline: string; personality: string; background: string; greeting: string; scenario: string; roleTemplate: string; tags: string; avatarUrl: string; copyrightStatement: string; reviewStatus: string; updatedAt: string; openReportCount: number; creator?: { username: string } };

const FIELDS = [
  ['简介', 'tagline'], ['人设', 'personality'], ['背景', 'background'], ['开场白', 'greeting'],
  ['场景', 'scenario'], ['扮演指引', 'roleTemplate'], ['标签', 'tags'], ['头像地址', 'avatarUrl'], ['版权声明', 'copyrightStatement'],
] as const;

export function CharacterReviewCard({ character, reason, onReason, onReview, canReview, busy, selected, onSelect }: { character: ReviewCharacter; reason: string; onReason: (value: string) => void; onReview: (status: string) => void; canReview: boolean; busy: boolean; selected: boolean; onSelect: (value: boolean) => void }) {
  return (
    <article className="flex flex-col gap-4 break-words rounded-xl border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-foreground">{character.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">创作者：{character.creator?.username || '系统'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={character.reviewStatus === 'PENDING' ? 'warning' : 'success'}>{character.reviewStatus === 'PENDING' ? '待审核' : '已公开'}</Badge>
          <Badge variant={character.openReportCount > 0 ? 'danger' : 'outline'}>未处理举报 {character.openReportCount}</Badge>
        </div>
      </header>
      {canReview && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={selected} disabled={busy} onChange={event => onSelect(event.target.checked)} />
          选择角色 {character.name}
        </label>
      )}
      <dl className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([label, key]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-all text-sm text-foreground">{character[key] || '未填写'}</dd>
          </div>
        ))}
      </dl>
      {canReview && (
        <div className="space-y-3 border-t border-border pt-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">审核说明（退回必填）</span>
            <Textarea rows={3} maxLength={1000} value={reason} onChange={event => onReason(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || character.reviewStatus === 'APPROVED'} onClick={() => onReview('APPROVED')}>通过公开</Button>
            <Button variant="danger" disabled={busy} onClick={() => onReview('REJECTED')}>退回 / 下架</Button>
          </div>
        </div>
      )}
    </article>
  );
}
