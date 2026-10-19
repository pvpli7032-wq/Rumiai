'use client';

import { RotateCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CircleAction, CircleContent, ManagedCircle } from './types';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function CircleEditor({ circle, canEdit, busy, onApply, onClose, onRefresh }: { circle: ManagedCircle | null; canEdit: boolean; busy: boolean; onApply: (action: CircleAction, reason: string, content?: CircleContent) => Promise<void>; onClose: () => void; onRefresh: () => void }) {
  const original = { name: circle?.name ?? '', description: circle?.description ?? '', tags: circle?.tags ?? '', universeId: circle?.universeId ?? null };
  const [content, setContent] = useState<CircleContent>(original), [reason, setReason] = useState('');
  const [worlds, setWorlds] = useState<{ id: string; name: string }[]>([]);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const dirty = JSON.stringify(content) !== JSON.stringify(original);
  const editable = canEdit && !circle?.owner?.deletedAt;
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/universes', { signal: controller.signal }).then(response => response.ok ? response.json() : []).then(rows => { if (!controller.signal.aborted && Array.isArray(rows)) setWorlds(rows); }).catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <>
      <AdminPanel
        title={circle ? `圈子详情 · ${circle.name}` : '新增站点圈子'}
        description={circle ? `${circle.status === 'ACTIVE' ? '公开' : '隐藏'} · ${circle.owner?.username ?? '站点所有'} · ${circle.id}` : '站点圈子不绑定运营人员个人账号，创建后先隐藏，恢复公开后才显示在前台。'}
        badge={circle ? <Badge variant={circle.status === 'ACTIVE' ? 'success' : 'neutral'}>{circle.status === 'ACTIVE' ? '公开' : '隐藏'}</Badge> : undefined}
        actions={<Button variant="ghost" size="sm" leadingIcon={<X className="h-4 w-4" />} disabled={busy} onClick={onClose}>关闭详情</Button>}
      >
        <div className="space-y-5">
          {circle && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">成员 {circle._count.members}</Badge>
              <Badge variant="outline">帖子 {circle._count.posts}</Badge>
              <Badge variant="outline">限制记录 {circle._count.restrictions}</Badge>
              <Badge variant={circle.isFeatured ? 'brand' : 'neutral'}>{circle.isFeatured ? '已推荐' : '未推荐'}</Badge>
            </div>
          )}
          {circle && (
            <Button variant="outline" size="sm" leadingIcon={<RotateCw className="h-4 w-4" />} disabled={busy} onClick={() => { if (!dirty) onRefresh(); else setConfirmRefresh(true); }}>重新读取详情</Button>
          )}
          {circle?.owner?.deletedAt && <AdminNotice tone="warning" title="作者已注销" description="保留其他成员的圈子历史；作者内容不能恢复或编辑。" />}
          <fieldset disabled={busy || !editable} className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">圈子名称</span>
              <Input aria-label="管理圈子名称" maxLength={40} value={content.name} onChange={event => setContent({ ...content, name: event.target.value })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">兴趣标签</span>
              <Input aria-label="管理圈子标签" maxLength={200} value={content.tags} onChange={event => setContent({ ...content, tags: event.target.value })} />
            </label>
            <label className="block space-y-1.5 md:col-span-2">
              <span className="text-sm font-medium">圈子介绍</span>
              <Textarea aria-label="管理圈子介绍" rows={4} maxLength={1000} value={content.description} onChange={event => setContent({ ...content, description: event.target.value })} />
            </label>
            <label className="block space-y-1.5 md:col-span-2">
              <span className="text-sm font-medium">关联公开世界观</span>
              <Select aria-label="管理圈子世界观" value={content.universeId ?? ''} onChange={event => setContent({ ...content, universeId: event.target.value || null })}>
                <option value="">不关联</option>
                {content.universeId && !worlds.some(world => world.id === content.universeId) && <option value={content.universeId}>当前关联（未公开或不在可选列表）</option>}
                {worlds.map(world => <option key={world.id} value={world.id}>{world.name}</option>)}
              </Select>
            </label>
          </fieldset>
          {canEdit && (
            <div className="space-y-4 border-t border-border pt-5">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">操作理由</span>
                <Textarea aria-label="圈子操作理由" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                {editable && (
                  <Button loading={busy} disabled={busy || !reason.trim() || !content.name.trim() || !content.description.trim() || (!!circle && !dirty)} onClick={() => void onApply('SAVE', reason, content)}>
                    {circle ? '保存圈子内容' : '创建站点圈子'}
                  </Button>
                )}
                {circle && (
                  <>
                    <Button variant="outline" disabled={busy || dirty || !reason.trim()} onClick={() => void onApply(circle.status === 'ACTIVE' ? 'HIDE' : 'RESTORE', reason)}>{circle.status === 'ACTIVE' ? '隐藏圈子' : '恢复公开'}</Button>
                    {circle.status === 'ACTIVE' && (
                      <Button variant="outline" disabled={busy || dirty || !reason.trim()} onClick={() => void onApply(circle.isFeatured ? 'UNFEATURE' : 'FEATURE', reason)}>{circle.isFeatured ? '取消推荐' : '推荐圈子'}</Button>
                    )}
                  </>
                )}
              </div>
              {dirty && circle && <p className="text-xs text-muted-foreground">先保存内容修改，再执行公开、隐藏或推荐操作。</p>}
            </div>
          )}
        </div>
      </AdminPanel>
      <Dialog
        open={confirmRefresh}
        onClose={() => setConfirmRefresh(false)}
        title="重新读取详情"
        description="重新读取详情会丢弃未保存的内容，是否继续？"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRefresh(false)}>取消</Button>
            <Button variant="danger" onClick={() => { setConfirmRefresh(false); onRefresh(); }}>丢弃并重新读取</Button>
          </>
        }
      />
    </>
  );
}
