'use client';

import { Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { DataTable, type DataTableColumn } from '@rumiai/ui/data-table';
import { Input } from '@rumiai/ui/input';

type GiftItem = { id: string; code: string; name: string; description: string | null; emoji: string; coinPrice: number; isActive: boolean; sortOrder: number; version: number };
type Draft = ReturnType<typeof blank>;
const blank = () => ({ code: '', name: '', description: '', emoji: '🎁', coinPrice: 10, isActive: true, sortOrder: 0, reason: '' });

export function GiftCatalogManagement({ sessionActive, canManage }: { sessionActive: boolean; canManage: boolean }) {
  const [items, setItems] = useState<GiftItem[]>([]), [draft, setDraft] = useState<Draft>(blank), [editing, setEditing] = useState<GiftItem | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false), [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/growth/gifts', {credentials: 'include', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    setItems(data.gifts); setLoaded(true);
  }, [sessionActive]);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);

  function startEdit(item: GiftItem) { setEditing(item); setDraft({ ...item, description: item.description ?? '', reason: '' }); }

  async function save() {
    setSaving(true); setError('');
    try {
      const url = editing ? `/api/admin/growth/gifts/${editing.id}` : '/api/admin/growth/gifts';
      const response = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, ...(editing ? { id: editing.id, version: editing.version } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      await refresh(); setEditing(null); setDraft(blank());
    } catch (e) { setError(e instanceof Error ? e.message : '礼物保存失败。'); } finally { setSaving(false); }
  }

  const columns: DataTableColumn<GiftItem>[] = [
    { id: 'gift', header: '礼物', cell: item => <span className="font-medium">{item.emoji} {item.name}</span> },
    { id: 'code', header: '代码', width: '160px', cell: item => <span className="text-xs text-muted-foreground">{item.code}</span> },
    { id: 'price', header: '金币', width: '120px', cell: item => <span className="tabular-nums">{item.coinPrice}</span> },
    { id: 'sort', header: '排序', width: '100px', cell: item => <span className="tabular-nums text-muted-foreground">{item.sortOrder}</span> },
    { id: 'status', header: '状态', width: '100px', cell: item => <Badge variant={item.isActive ? 'success' : 'neutral'}>{item.isActive ? '启用' : '停用'}</Badge> },
    ...(canManage
      ? [{ id: 'actions', header: '操作', align: 'right' as const, width: '120px', cell: (item: GiftItem) => (
          <Button variant="outline" size="sm" leadingIcon={<Pencil className="h-3.5 w-3.5" />} disabled={saving} onClick={() => startEdit(item)}>编辑</Button>
        ) }]
      : []),
  ];

  return (
    <AdminPanel
      aria-label="礼物目录"
      title="礼物目录"
      description="赠礼价格由服务器目录决定；停用仅影响新赠送，历史礼物记录保留原价。"
      badge={<Badge variant="outline">{items.length} 个礼物</Badge>}
    >
      <div className="space-y-5">
        <DataTable columns={columns} rows={items} getRowId={item => item.id} loading={!loaded} empty="暂无礼物配置。" />
        {canManage && (
          <form className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); void save(); }}>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">礼物代码</span>
              <Input disabled={!!editing || saving} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} placeholder="rose" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">名称</span>
              <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">图标</span>
              <Input value={draft.emoji} onChange={e => setDraft({ ...draft, emoji: e.target.value })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">金币价格</span>
              <Input type="number" min={1} max={1000000} value={draft.coinPrice} onChange={e => setDraft({ ...draft, coinPrice: Number(e.target.value) })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">排序</span>
              <Input type="number" min={0} value={draft.sortOrder} onChange={e => setDraft({ ...draft, sortOrder: Number(e.target.value) })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">说明</span>
              <Input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />
              启用礼物
            </label>
            <label className="block space-y-1.5 sm:col-span-2 xl:col-span-3">
              <span className="text-sm font-medium">操作理由</span>
              <Input maxLength={500} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} />
            </label>
            <div className="flex flex-wrap items-end gap-2 xl:col-span-4">
              <Button type="submit" loading={saving} leadingIcon={<Plus className="h-4 w-4" />} disabled={saving || !draft.reason.trim()}>{editing ? '保存礼物' : '新增礼物'}</Button>
              {editing && <Button type="button" variant="outline" disabled={saving} onClick={() => { setEditing(null); setDraft(blank()); }}>取消编辑</Button>}
            </div>
          </form>
        )}
        {error && <AdminNotice tone="error" title={error} />}
      </div>
    </AdminPanel>
  );
}
