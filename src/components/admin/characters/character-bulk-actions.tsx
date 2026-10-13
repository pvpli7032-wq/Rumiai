import {useState} from 'react';
import type {CharacterSummary} from './types';
export function CharacterBulkActions({items, busy, onApply}: {items: CharacterSummary[]; busy: boolean; onApply: (action: 'PUBLISH' | 'UNPUBLISH', reason: string, items: CharacterSummary[]) => Promise<boolean>}) {
  const [reason, setReason] = useState('');
  async function apply(action: 'PUBLISH' | 'UNPUBLISH') {
    if (busy || !reason.trim() || !items.length || items.length > 25) return;
    if (!window.confirm(`确认${action === 'PUBLISH' ? '公开' : '下架'}选中的 ${items.length} 个角色？`)) return;
    if (await onApply(action, reason, items)) setReason('');
  }
  return <section aria-label="批量角色发布" className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">批量发布 · 已选 {items.length} 个</h2><label className="block text-sm">批量操作理由<textarea maxLength={500} className="mt-1 min-h-20 w-full rounded-lg border bg-background p-2" value={reason} onChange={event => setReason(event.target.value)} /></label><div className="flex flex-wrap gap-3"><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy || !items.length || items.length > 25 || !reason.trim()} onClick={() => void apply('PUBLISH')}>批量发布角色</button><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy || !items.length || items.length > 25 || !reason.trim()} onClick={() => void apply('UNPUBLISH')}>批量下架角色</button></div><p className="text-xs text-muted-foreground">单次最多25个；版权缺失、已删除或版本变化会阻止整批执行。</p></section>;
}
