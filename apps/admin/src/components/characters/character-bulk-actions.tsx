'use client';

import { CheckCheck, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { AdminPanel } from '../admin-page';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { Dialog } from '@rumiai/ui/dialog';
import { Textarea } from '@rumiai/ui/textarea';
import type { CharacterSummary } from './types';

type BulkAction = 'PUBLISH' | 'UNPUBLISH';

export function CharacterBulkActions({ items, busy, onApply }: { items: CharacterSummary[]; busy: boolean; onApply: (action: BulkAction, reason: string, items: CharacterSummary[]) => Promise<boolean> }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<BulkAction | null>(null);
  const tooMany = items.length > 25;
  const ready = !!items.length && !tooMany && !!reason.trim();

  async function confirm(action: BulkAction) {
    setPending(null);
    if (await onApply(action, reason, items)) setReason('');
  }

  return (
    <>
      <AdminPanel
        title="批量发布"
        description="单次最多 25 个；版权缺失、已删除或版本变化会阻止整批执行。"
        badge={<Badge variant={tooMany ? 'danger' : 'outline'}>已选 {items.length} 个</Badge>}
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">批量操作理由</span>
            <Textarea rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button leadingIcon={<CheckCheck className="h-4 w-4" />} disabled={busy || !ready} onClick={() => setPending('PUBLISH')}>批量发布角色</Button>
            <Button variant="outline" leadingIcon={<Undo2 className="h-4 w-4" />} disabled={busy || !ready} onClick={() => setPending('UNPUBLISH')}>批量下架角色</Button>
          </div>
        </div>
      </AdminPanel>
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending === 'PUBLISH' ? '确认批量发布' : '确认批量下架'}
        description={`即将对选中的 ${items.length} 个角色执行该操作，操作会写入管理审计。`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>取消</Button>
            <Button variant={pending === 'PUBLISH' ? 'primary' : 'danger'} disabled={busy} onClick={() => pending && void confirm(pending)}>确认执行</Button>
          </>
        }
      />
    </>
  );
}
