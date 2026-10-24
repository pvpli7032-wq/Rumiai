'use client';

import { Pencil } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminNotice, AdminPanel, AdminPanelGroup, AdminPlaceholder } from '@admin/components/admin-page';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { Dialog } from '@rumiai/ui/dialog';
import { Textarea } from '@rumiai/ui/textarea';
import { DataTable, type DataTableColumn } from '@admin/components/layout/data-table';
import { Input } from '@rumiai/ui/input';
import { formatCny } from '@rumiai/contracts/format/number';
import { toDateTimeLocalInput } from '@rumiai/contracts/format/date-time';

type Package = { id: string; label: string; coins: number; bonus: number; benefits: string[]; priceCnyCents: number | null; sortOrder: number; isActive: boolean; version: number; bonusStartsAt: string | null; bonusEndsAt: string | null; effectiveBonus: number; totalCoins: number; referenceCount: number };
type Change = { id: string; packageId: string; actorId: string; createdAt: string; beforeJson: string | null; afterJson: string };
type Form = { label: string; coins: string; bonus: string; benefits: string; price: string; sortOrder: string; isActive: boolean; start: string; end: string };
const empty: Form = { label: '', coins: '60', bonus: '0', benefits: '', price: '6', sortOrder: '0', isActive: true, start: '', end: '' };

export function FinancePackages({ sessionActive, canEdit }: { sessionActive: boolean; canEdit: boolean }) {
  const [packages, setPackages] = useState<Package[]>([]), [changes, setChanges] = useState<Change[]>([]);
  const [editing, setEditing] = useState<Package | null>(null), [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState(''), [deleting, setDeleting] = useState<Package | null>(null), [deleteReason, setDeleteReason] = useState('');
  const busyRef = useRef(false);
  const load = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/finance/packages', {credentials: 'include', cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '套餐加载失败。');
      if (!signal?.aborted) { setPackages(data.packages); setChanges(data.changes); return true; }
      return false;
    } catch (e) { if (!signal?.aborted) { setError((e as Error).message); } return false; }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [sessionActive]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const [dirty, setDirty] = useState(false);
  function edit(pkg: Package) {
    if (dirty && !window.confirm('当前套餐有未保存修改，切换套餐会放弃修改，继续吗？')) return;
    setDirty(false); setEditing(pkg); setError(''); setMessage('');
    setForm({ label: pkg.label, coins: String(pkg.coins), bonus: String(pkg.bonus), benefits: pkg.benefits.join('\n'), price: pkg.priceCnyCents === null ? '' : (pkg.priceCnyCents / 100).toFixed(2), sortOrder: String(pkg.sortOrder), isActive: pkg.isActive, start: toDateTimeLocalInput(pkg.bonusStartsAt), end: toDateTimeLocalInput(pkg.bonusEndsAt) });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busyRef.current || !canEdit) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (!/^\d+(?:\.\d{1,2})?$/.test(form.price)) throw Error('人民币价格最多两位小数。');
      const body = { label: form.label, coins: Number(form.coins), bonus: Number(form.bonus), benefits: form.benefits.split('\n').map(item => item.trim()).filter(Boolean), priceCnyCents: Math.round(Number(form.price) * 100), sortOrder: Number(form.sortOrder), isActive: form.isActive, bonusStartsAt: form.start ? new Date(form.start).toISOString() : null, bonusEndsAt: form.end ? new Date(form.end).toISOString() : null, ...(editing ? { version: editing.version } : {}) };
      const response = await fetch(editing ? `/api/admin/finance/packages/${encodeURIComponent(editing.id)}` : '/api/admin/finance/packages', { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { if (response.status === 409) await load(); throw Error(data.error || '保存失败。'); }
      setEditing(null); setForm(empty); setDirty(false); setMessage('套餐已保存，新订单使用最新配置。');
      if (!await load()) setError('套餐已保存，但列表刷新失败，请手动刷新。');
    } catch (e) { setError((e as Error).message); } finally { busyRef.current = false; setBusy(false); }
  }

  const field = (key: keyof Form, value: string | boolean) => { setDirty(true); setForm(previous => ({ ...previous, [key]: value })); };

  const columns: DataTableColumn<Package>[] = [
    { id: 'label', header: '套餐', cell: pkg => (
      <div className="min-w-0">
        <p className="font-medium text-foreground">{pkg.label}</p>
        <p className="text-xs text-muted-foreground">排序 {pkg.sortOrder} · 版本 {pkg.version}</p>
      </div>
    ) },
    { id: 'price', header: '价格', width: '120px', cell: pkg => <span className="tabular-nums">{pkg.priceCnyCents === null ? '价格待配置' : formatCny(pkg.priceCnyCents)}</span> },
    { id: 'coins', header: '金币', width: '180px', cell: pkg => <span className="tabular-nums">基础 {pkg.coins} · 当前赠送 {pkg.effectiveBonus} · 总计 {pkg.totalCoins}</span> },
    { id: 'bonus', header: '赠送活动', cell: pkg => pkg.bonusStartsAt
      ? <span className="text-xs text-muted-foreground">{new Date(pkg.bonusStartsAt).toLocaleString('zh-CN')} 至 {new Date(pkg.bonusEndsAt!).toLocaleString('zh-CN')}</span>
      : <span className="text-xs text-muted-foreground">长期赠送 {pkg.bonus}</span> },
    { id: 'status', header: '状态', width: '100px', cell: pkg => <Badge variant={pkg.isActive ? 'success' : 'neutral'}>{pkg.isActive ? '已上架' : '已下架'}</Badge> },
    ...(canEdit
      ? [{ id: 'actions', header: '操作', align: 'right' as const, width: '120px', cell: (pkg: Package) => (
          <div className="flex flex-wrap items-center justify-end gap-2">{!pkg.isActive && <span className="text-xs text-muted-foreground">订单引用 {pkg.referenceCount} 条</span>}<Button variant="outline" size="sm" aria-label={`编辑 ${pkg.label}`} leadingIcon={<Pencil className="h-3.5 w-3.5" />} disabled={busy} onClick={() => edit(pkg)}>编辑</Button>{!pkg.isActive && pkg.referenceCount === 0 && <Button variant="danger" size="sm" disabled={busy} onClick={() => { setError(''); setDeleteReason(''); setDeleting(pkg); }}>删除</Button>}</div>
        ) }]
      : []),
  ];

  return (
    <AdminPanelGroup>
      <AdminPanel
        title="充值套餐与赠送活动"
        description="配置基础金币、赠送和上架状态。定时活动按当前设备时区填写；不填时间则持续赠送。旧订单金额及金币保持原快照。"
        badge={<Badge variant="outline">{packages.length} 个套餐</Badge>}
        flush
      >
        {/* 提示压在表格上方，保存成功后套餐列表必须仍然可见可操作。 */}
        {error && <div className="border-b border-border p-5"><AdminNotice tone="error" title={error} className="py-6" /></div>}
        {message && <div className="border-b border-border p-5"><AdminNotice tone="success" title={message} className="py-6" /></div>}
        <DataTable columns={columns} rows={packages} getRowId={pkg => pkg.id} loading={loading} empty={!loading && !packages.length ? '暂无套餐配置。' : undefined} />
        {changes.length > 0 && (
          <details className="border-t border-border px-5 py-4">
            <summary className="cursor-pointer text-sm font-medium">最近修改记录（{changes.length} 条）</summary>
            <div className="mt-3 space-y-2">
              {changes.map(change => (
                <div key={change.id} className="space-y-1 break-all border-t border-border pt-2 text-xs">
                  <p>{new Date(change.createdAt).toLocaleString('zh-CN')} · 操作人 {change.actorId} · 套餐 {change.packageId}</p>
                  <p>修改前：{change.beforeJson || '新增'}</p>
                  <p>修改后：{change.afterJson}</p>
                </div>
              ))}
            </div>
          </details>
        )}
      </AdminPanel>

      {canEdit && (
        <AdminPanel title={editing ? `编辑套餐：${editing.label}` : '新增套餐'} description="价格最多两位小数，保存后立即对新下单生效。">
          <form className="space-y-4" onSubmit={save}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">套餐名称</span>
                <Input required maxLength={32} value={form.label} onChange={e => field('label', e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">人民币价格（元）</span>
                <Input required inputMode="decimal" value={form.price} onChange={e => field('price', e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">基础金币</span>
                <Input required type="number" min="1" step="1" value={form.coins} onChange={e => field('coins', e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">赠送金币</span>
                <Input required type="number" min="0" step="1" value={form.bonus} onChange={e => field('bonus', e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">活动开始</span>
                <Input type="datetime-local" value={form.start} onChange={e => field('start', e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">活动结束</span>
                <Input type="datetime-local" value={form.end} onChange={e => field('end', e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">排序</span>
                <Input required type="number" min="0" max="10000" value={form.sortOrder} onChange={e => field('sortOrder', e.target.value)} />
              </label>
              <label className="block space-y-1.5 sm:col-span-2 lg:col-span-3">
                <span className="text-sm font-medium">权益说明（每行一条，最多 8 条）</span>
                <Textarea rows={4} maxLength={648} value={form.benefits} onChange={e => field('benefits', e.target.value)} placeholder="不填写则不展示任何额外权益" />
              </label>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={form.isActive} onChange={e => field('isActive', e.target.checked)} />
                上架套餐
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy}>{busy ? '保存中…' : '保存套餐'}</Button>
              <Button variant="outline" disabled={busy} onClick={() => { if (dirty && !window.confirm('当前套餐有未保存修改，确定关闭并放弃吗？')) return; setDirty(false); setEditing(null); setForm(empty); setError(''); }}>取消编辑</Button>
              {editing && <AdminPlaceholder>正在编辑已有套餐，保存会写入新版本。</AdminPlaceholder>}
            </div>
          </form>
        </AdminPanel>
      )}
      <Dialog open={!!deleting} onClose={() => { if (!busy) setDeleting(null); }} title="删除已下架套餐" description="仅允许删除没有订单快照引用的套餐；删除后不可恢复。" size="md" footer={<><Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" loading={busy} disabled={busy || !deleteReason.trim()} onClick={async () => { if (!deleting || busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); try { const response = await fetch(`/api/admin/finance/packages/${encodeURIComponent(deleting.id)}`, {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({version: deleting.version, reason: deleteReason.trim()})}); const data = await response.json(); if (!response.ok) throw Error(data.error || '套餐删除失败。'); setDeleting(null); setMessage('套餐已删除。'); await load(); } catch (e) { setError(e instanceof Error ? e.message : '套餐删除失败。'); } finally { busyRef.current = false; setBusy(false); } }}>确认删除</Button></>}>
        {deleting && <p className="mb-3 text-sm text-muted-foreground">当前订单快照引用：{deleting.referenceCount} 条。</p>}{error && <AdminNotice tone="error" title={error} className="mb-3" />}<label className="block space-y-1.5"><span className="text-sm font-medium">删除理由</span><Textarea required maxLength={500} rows={3} value={deleteReason} onChange={event => setDeleteReason(event.target.value)} /></label>
      </Dialog>
    </AdminPanelGroup>
  );
}
