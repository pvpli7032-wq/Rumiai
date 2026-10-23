'use client';

import { Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { DataTable, type DataTableColumn } from '@admin/components/layout/data-table';
import { Input } from '@rumiai/ui/input';
import { Dialog } from '@rumiai/ui/dialog';
import { Textarea } from '@rumiai/ui/textarea';

type GiftItem = { id: string; code: string; name: string; description: string | null; emoji: string; coinPrice: number; isActive: boolean; sortOrder: number; version: number; referenceCount: number };
type Draft = ReturnType<typeof blank>;
const blank = () => ({ code: '', name: '', description: '', emoji: '🎁', coinPrice: 10, isActive: true, sortOrder: 0, reason: '' });

export function GiftCatalogManagement({ sessionActive, canManage }: { sessionActive: boolean; canManage: boolean }) {
  const [items, setItems] = useState<GiftItem[]>([]), [draft, setDraft] = useState<Draft>(blank), [editing, setEditing] = useState<GiftItem | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false), [loaded, setLoaded] = useState(false), [dirty, setDirty] = useState(false), [deleting, setDeleting] = useState<GiftItem | null>(null), [deleteReason, setDeleteReason] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/growth/gifts', {credentials: 'include', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    setItems(data.gifts); setLoaded(true);
  }, [sessionActive]);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);

  function startEdit(item: GiftItem) { if (saving || (dirty && !window.confirm('当前礼物有未保存修改，切换礼物会放弃修改，继续吗？'))) return; setDirty(false); setEditing(item); setError(''); setDraft({ code: item.code, name: item.name, description: item.description ?? '', emoji: item.emoji, coinPrice: item.coinPrice, isActive: item.isActive, sortOrder: item.sortOrder, reason: '' }); }

  async function save() {
    setSaving(true); setError('');
    try {
      const url = editing ? `/api/admin/growth/gifts/${editing.id}` : '/api/admin/growth/gifts';
      const response = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, ...(editing ? { id: editing.id, version: editing.version } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setEditing(null); setDraft(blank()); setDirty(false);
      try { await refresh(); } catch { setError('礼物已保存，但列表刷新失败，请手动刷新。'); }
    } catch (e) { setError(e instanceof Error ? e.message : '礼物保存失败。'); } finally { setSaving(false); }
  }

  const columns: DataTableColumn<GiftItem>[] = [
    { id: 'gift', header: '礼物', cell: item => <span className="font-medium">{item.emoji} {item.name}</span> },
    { id: 'code', header: '代码', width: '160px', cell: item => <span className="text-xs text-muted-foreground">{item.code}</span> },
    { id: 'price', header: '金币', width: '120px', cell: item => <span className="tabular-nums">{item.coinPrice}</span> },
    { id: 'sort', header: '排序', width: '100px', cell: item => <span className="tabular-nums text-muted-foreground">{item.sortOrder}</span> },
    { id: 'status', header: '状态', width: '100px', cell: item => <Badge variant={item.isActive ? 'success' : 'neutral'}>{item.isActive ? '启用' : '停用'}</Badge> },
    ...(canManage
          ? [{ id: 'actions', header: '操作', align: 'right' as const, width: '180px', cell: (item: GiftItem) => (
          <div className="flex flex-wrap items-center justify-end gap-2">{!item.isActive && <span className="text-xs text-muted-foreground">历史赠送 {item.referenceCount} 条</span>}<Button variant="outline" size="sm" leadingIcon={<Pencil className="h-3.5 w-3.5" />} disabled={saving} onClick={() => startEdit(item)}>编辑</Button>{!item.isActive && item.referenceCount === 0 && <Button variant="danger" size="sm" disabled={saving} onClick={() => { setError(''); setDeleteReason(''); setDeleting(item); }}>删除</Button>}</div>
        ) }]
      : []),
  ];

  return (
    <>
    <AdminPanel
      className="border-border bg-card shadow-sm"
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
              <Input disabled={!!editing || saving} value={draft.code} onChange={e => { setDirty(true); setDraft({ ...draft, code: e.target.value }); }} placeholder="rose" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">名称</span>
            <Input value={draft.name} onChange={e => { setDirty(true); setDraft({ ...draft, name: e.target.value }); }} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">图标</span>
              <Input value={draft.emoji} onChange={e => { setDirty(true); setDraft({ ...draft, emoji: e.target.value }); }} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">金币价格</span>
              <Input type="number" min={1} max={1000000} value={draft.coinPrice} onChange={e => { setDirty(true); setDraft({ ...draft, coinPrice: Number(e.target.value) }); }} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">排序</span>
              <Input type="number" min={0} value={draft.sortOrder} onChange={e => { setDirty(true); setDraft({ ...draft, sortOrder: Number(e.target.value) }); }} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">说明</span>
              <Input value={draft.description} onChange={e => { setDirty(true); setDraft({ ...draft, description: e.target.value }); }} />
            </label>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} onChange={e => { setDirty(true); setDraft({ ...draft, isActive: e.target.checked }); }} />
              启用礼物
            </label>
            <label className="block space-y-1.5 sm:col-span-2 xl:col-span-3">
              <span className="text-sm font-medium">操作理由</span>
              <Input maxLength={500} value={draft.reason} onChange={e => { setDirty(true); setDraft({ ...draft, reason: e.target.value }); }} />
            </label>
            <div className="flex flex-wrap items-end gap-2 xl:col-span-4">
              <Button type="submit" loading={saving} leadingIcon={<Plus className="h-4 w-4" />} disabled={saving || !draft.reason.trim()}>{editing ? '保存礼物' : '新增礼物'}</Button>
              {editing && <Button type="button" variant="outline" disabled={saving} onClick={() => { if (dirty && !window.confirm('当前礼物有未保存修改，确定关闭并放弃吗？')) return; setDirty(false); setEditing(null); setDraft(blank()); }}>取消编辑</Button>}
            </div>
          </form>
        )}
        {error && <AdminNotice tone="error" title={error} />}
      </div>
    </AdminPanel>
    <Dialog open={!!deleting} onClose={() => { if (!saving) setDeleting(null); }} title="删除已停用礼物" description="仅允许删除没有历史赠送记录的礼物；删除后不可恢复。" size="md" footer={<><Button variant="ghost" disabled={saving} onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" loading={saving} disabled={saving || !deleteReason.trim()} onClick={async () => { if (!deleting) return; setSaving(true); setError(''); try { const response = await fetch(`/api/admin/growth/gifts/${encodeURIComponent(deleting.id)}`, {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({version: deleting.version, reason: deleteReason.trim()})}); const data = await response.json(); if (!response.ok) throw Error(data.error || '礼物删除失败。'); setDeleting(null); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : '礼物删除失败。'); } finally { setSaving(false); } }}>确认删除</Button></>}>
      {deleting && <p className="mb-3 text-sm text-muted-foreground">当前关联赠送记录：{deleting.referenceCount} 条。</p>}{error && <AdminNotice tone="error" title={error} className="mb-3" />}<label className="block space-y-1.5"><span className="text-sm font-medium">删除理由</span><Textarea required maxLength={500} rows={3} value={deleteReason} onChange={event => setDeleteReason(event.target.value)} /></label>
    </Dialog>
    </>
  );
}
