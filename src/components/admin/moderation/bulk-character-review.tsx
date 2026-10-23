'use client';
import {useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import type {ReviewCharacter} from './character-review-card';
import {AdminNotice, AdminPanel} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {Textarea} from '@/components/ui/textarea';

type ReviewStatus = 'APPROVED' | 'REJECTED';

/** 单次批量上限，与后端 `/api/admin/moderation/characters/batch` 一致。 */
const BATCH_LIMIT = 25;

export function BulkCharacterReview({selected, sessionActive, disabled, onStart, onFinish, onSaved}: {selected: ReviewCharacter[]; sessionActive: boolean; disabled: boolean; onStart: () => void; onFinish: () => void; onSaved: () => Promise<void>}) {
  const [reason, setReason] = useState(''), [error, setError] = useState('');
  const [pending, setPending] = useState<ReviewStatus | null>(null);
  const tooMany = selected.length > BATCH_LIMIT;
  const blocked = disabled || !selected.length || tooMany;

  async function review(status: ReviewStatus) {
    setPending(null);
    if (disabled || !selected.length || tooMany) return;
    if (status === 'REJECTED' && !reason.trim()) {setError('批量退回须填写理由。'); return;}
    onStart(); setError('');
    try {
      const response = await fetch('/api/admin/moderation/characters/batch', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status, reason, items: selected.map(character => ({id: character.id, updatedAt: character.updatedAt}))})});
      const data = await response.json(); if (!response.ok) throw Error(data.error || '批量审核失败。');
      setReason(''); await onSaved();
    } catch (value) {setError((value as Error).message);} finally {onFinish();}
  }

  function start(status: ReviewStatus) {
    if (blocked) return;
    if (status === 'REJECTED' && !reason.trim()) {setError('批量退回须填写理由。'); return;}
    setError(''); setPending(status);
  }

  return (
    <>
      <AdminPanel
        title="批量审核"
        description={`单次最多 ${BATCH_LIMIT} 个。有角色被修改、撤回或缺少版权声明时，整批不执行。`}
        badge={<Badge variant={tooMany ? 'danger' : 'brand'}>已选 {selected.length} 个</Badge>}
        actions={
          <>
            <Button size="sm" variant="outline" disabled={blocked} onClick={() => start('APPROVED')}>批量通过公开</Button>
            <Button size="sm" variant="danger" disabled={blocked} onClick={() => start('REJECTED')}>批量退回 / 下架</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">批量审核说明</span>
            <Textarea aria-label="批量审核说明" rows={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
          </label>
          {error && <AdminNotice tone="error" title={error} className="py-6" />}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />批量通过也要求角色已具备版权声明，缺失者整批终止。
          </p>
        </div>
      </AdminPanel>
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending === 'APPROVED' ? '确认批量通过公开' : '确认批量退回 / 下架'}
        description={`确认${pending === 'APPROVED' ? '通过公开' : '退回 / 下架'}选中的 ${selected.length} 个角色？`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>取消</Button>
            <Button variant={pending === 'APPROVED' ? 'primary' : 'danger'} onClick={() => pending && void review(pending)}>确认执行</Button>
          </>
        }
      />
    </>
  );
}
