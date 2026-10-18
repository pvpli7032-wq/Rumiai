'use client';
import {useState} from 'react';
import type {ReviewCharacter} from './character-review-card';

export function BulkCharacterReview({selected, token, disabled, onStart, onFinish, onSaved}: {selected: ReviewCharacter[]; token: string; disabled: boolean; onStart: () => void; onFinish: () => void; onSaved: () => Promise<void>}) {
  const [reason, setReason] = useState(''), [error, setError] = useState('');
  async function review(status: 'APPROVED' | 'REJECTED') {
    if (disabled || !selected.length || selected.length > 25) return;
    if (status === 'REJECTED' && !reason.trim()) {setError('批量退回须填写理由。'); return;}
    if (!window.confirm(`确认${status === 'APPROVED' ? '通过公开' : '退回 / 下架'}选中的 ${selected.length} 个角色？`)) return;
    onStart(); setError('');
    try {
      const response = await fetch('/api/moderation/characters/batch', {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({status, reason, items: selected.map(character => ({id: character.id, updatedAt: character.updatedAt}))})});
      const data = await response.json(); if (!response.ok) throw Error(data.error || '批量审核失败。');
      setReason(''); await onSaved();
    } catch (value) {setError((value as Error).message);} finally {onFinish();}
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="批量角色审核"><h2 className="font-semibold">批量审核 · 已选 {selected.length} 个</h2><p className="text-sm text-muted-foreground">单次最多25个。有角色被修改、撤回或缺少版权声明时，整批不执行。</p><label className="block text-sm">批量审核说明<textarea maxLength={1000} className="mt-1 min-h-20 w-full rounded-lg border bg-background p-2" value={reason} onChange={event => setReason(event.target.value)} /></label>{error && <p role="alert" className="text-red-400">{error}</p>}<div className="flex flex-wrap gap-3"><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={disabled || !selected.length || selected.length > 25} onClick={() => void review('APPROVED')}>批量通过公开</button><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={disabled || !selected.length || selected.length > 25} onClick={() => void review('REJECTED')}>批量退回 / 下架</button></div></section>;
}
