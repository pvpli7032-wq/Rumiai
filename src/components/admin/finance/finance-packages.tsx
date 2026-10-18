'use client';
import { useCallback, useEffect, useState } from 'react';

type Package = { id: string; label: string; coins: number; bonus: number; priceCnyCents: number | null; sortOrder: number; isActive: boolean; version: number; bonusStartsAt: string | null; bonusEndsAt: string | null; effectiveBonus: number };
type Change = { id: string; packageId: string; actorId: string; createdAt: string; beforeJson: string | null; afterJson: string };
type Form = { label: string; coins: string; bonus: string; price: string; sortOrder: string; isActive: boolean; start: string; end: string };
const empty: Form = { label: '', coins: '60', bonus: '0', price: '6', sortOrder: '0', isActive: true, start: '', end: '' };
function localTime(value: string | null) {
  if (!value) return '';
  const time = new Date(value);
  return new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function FinancePackages({ token, canEdit }: { token: string; canEdit: boolean }) {
  const [packages, setPackages] = useState<Package[]>([]), [changes, setChanges] = useState<Change[]>([]);
  const [editing, setEditing] = useState<Package | null>(null), [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/finance/packages', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '套餐加载失败。');
      if (!signal?.aborted) { setPackages(data.packages); setChanges(data.changes); }
    } catch (e) { if (!signal?.aborted) { setPackages([]); setChanges([]); setError((e as Error).message); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [token]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function edit(pkg: Package) {
    setEditing(pkg); setError(''); setMessage('');
    setForm({ label: pkg.label, coins: String(pkg.coins), bonus: String(pkg.bonus), price: pkg.priceCnyCents === null ? '' : (pkg.priceCnyCents / 100).toFixed(2), sortOrder: String(pkg.sortOrder), isActive: pkg.isActive, start: localTime(pkg.bonusStartsAt), end: localTime(pkg.bonusEndsAt) });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy || !canEdit) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (!/^\d+(?:\.\d{1,2})?$/.test(form.price)) throw Error('人民币价格最多两位小数。');
      const body = { label: form.label, coins: Number(form.coins), bonus: Number(form.bonus), priceCnyCents: Math.round(Number(form.price) * 100), sortOrder: Number(form.sortOrder), isActive: form.isActive, bonusStartsAt: form.start ? new Date(form.start).toISOString() : null, bonusEndsAt: form.end ? new Date(form.end).toISOString() : null, ...(editing ? { version: editing.version } : {}) };
      const response = await fetch(editing ? `/api/admin/finance/packages/${encodeURIComponent(editing.id)}` : '/api/admin/finance/packages', { method: editing ? 'PUT' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { if (response.status === 409) await load(); throw Error(data.error || '保存失败。'); }
      setEditing(null); setForm(empty); setMessage('套餐已保存，新订单使用最新配置。'); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const field = (key: keyof Form, value: string | boolean) => setForm(previous => ({ ...previous, [key]: value }));
  return <section className="space-y-4 rounded-xl border p-4">
    <h2 className="font-bold">充值套餐与赠送活动</h2>
    <p className="text-sm text-muted-foreground">配置基础金币、赠送和上架状态。定时活动按当前设备时区填写；不填时间则持续赠送。旧订单金额及金币保持原快照。</p>
    {error && <p role="alert" className="text-red-400">{error}</p>}{message && <p role="status">{message}</p>}
    {loading && <p role="status">正在读取套餐…</p>}
    <div className="space-y-2">{packages.map(pkg => <article key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border p-3">
      <div className="min-w-0 break-words"><p>{pkg.label} · {pkg.isActive ? '已上架' : '已下架'} · {pkg.priceCnyCents === null ? '价格待配置' : `¥${(pkg.priceCnyCents / 100).toFixed(2)}`}</p><p className="text-sm">基础 {pkg.coins} · 当前赠送 {pkg.effectiveBonus} · 设置赠送 {pkg.bonus}</p>{pkg.bonusStartsAt && <p className="text-xs">{new Date(pkg.bonusStartsAt).toLocaleString('zh-CN')} 至 {new Date(pkg.bonusEndsAt!).toLocaleString('zh-CN')}</p>}</div>
      {canEdit && <button type="button" className="min-h-11 rounded-sm border px-3" disabled={busy} onClick={() => edit(pkg)}>编辑 {pkg.label}</button>}
    </article>)}</div>
    {canEdit && <form className="space-y-3 border-t pt-4" onSubmit={save}>
      <h3 className="font-medium">{editing ? `编辑套餐：${editing.label}` : '新增套餐'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>套餐名称<input required maxLength={32} className="mt-1 min-h-11 w-full rounded-sm border bg-background px-2" value={form.label} onChange={e => field('label', e.target.value)} /></label>
        <label>人民币价格（元）<input required inputMode="decimal" className="mt-1 min-h-11 w-full rounded-sm border bg-background px-2" value={form.price} onChange={e => field('price', e.target.value)} /></label>
        <label>基础金币<input required type="number" min="1" step="1" className="mt-1 min-h-11 w-full rounded-sm border bg-background px-2" value={form.coins} onChange={e => field('coins', e.target.value)} /></label>
        <label>赠送金币<input required type="number" min="0" step="1" className="mt-1 min-h-11 w-full rounded-sm border bg-background px-2" value={form.bonus} onChange={e => field('bonus', e.target.value)} /></label>
        <label>活动开始<input type="datetime-local" className="mt-1 min-h-11 w-full min-w-0 rounded-sm border bg-background px-2" value={form.start} onChange={e => field('start', e.target.value)} /></label>
        <label>活动结束<input type="datetime-local" className="mt-1 min-h-11 w-full min-w-0 rounded-sm border bg-background px-2" value={form.end} onChange={e => field('end', e.target.value)} /></label>
        <label>排序<input required type="number" min="0" max="10000" className="mt-1 min-h-11 w-full rounded-sm border bg-background px-2" value={form.sortOrder} onChange={e => field('sortOrder', e.target.value)} /></label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={e => field('isActive', e.target.checked)} />上架套餐</label>
      </div>
      <div className="flex flex-wrap gap-2"><button disabled={busy} className="min-h-11 rounded-sm bg-brand px-4 text-white disabled:opacity-50">{busy ? '保存中…' : '保存套餐'}</button><button disabled={busy} type="button" className="min-h-11 rounded-sm border px-4" onClick={() => { setEditing(null); setForm(empty); setError(''); }}>取消编辑</button></div>
    </form>}
    <details className="border-t pt-3"><summary className="cursor-pointer">最近修改记录（{changes.length} 条）</summary>{changes.map(change => <div key={change.id} className="space-y-1 break-all border-t py-2 text-xs"><p>{new Date(change.createdAt).toLocaleString('zh-CN')} · 操作人 {change.actorId} · 套餐 {change.packageId}</p><p>修改前：{change.beforeJson || '新增'}</p><p>修改后：{change.afterJson}</p></div>)}</details>
  </section>;
}
