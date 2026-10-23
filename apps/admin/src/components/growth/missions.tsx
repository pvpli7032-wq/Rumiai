'use client';

import { Pencil, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { Dialog } from '@rumiai/ui/dialog';
import { Input } from '@rumiai/ui/input';
import { Select } from '@rumiai/ui/select';
import { Textarea } from '@rumiai/ui/textarea';
import { API } from '@rumiai/contracts/api-paths';
import { toDateTimeLocalInput } from '@rumiai/contracts/format/date-time';

export type Mission = { id: string; title: string; description: string | null; rewardCoins: number; category: string; conditionType: string; conditionTarget: number; period: string; isActive: boolean; sortOrder: number; version: number; startsAt: string | null; endsAt: string | null; referenceCount: number };
type Draft = { id?: string; version: number; title: string; description: string; rewardCoins: number; category: string; conditionType: string; conditionTarget: number; period: string; isActive: boolean; sortOrder: number; startsAt: string; endsAt: string; reason: string };

const CATEGORIES = [['DAILY', '每日'], ['ONBOARDING', '新手'], ['STARTER', '入门'], ['SPECIAL', '特别'], ['CREATOR', '创作']] as const;
const CONDITIONS = [['CHECKIN_COUNT', '签到次数'], ['MESSAGE_COUNT', '用户消息数'], ['POST_COUNT', '公开帖子数'], ['COMMENT_COUNT', '公开评论数'], ['MANUAL', '手动核验（不可发奖）']] as const;
const PERIODS = [['ONCE', '一次'], ['DAILY', '每日'], ['WEEKLY', '每周']] as const;
const PERIOD_LABELS = { ONCE: '一次', DAILY: '每日', WEEKLY: '每周' } as Record<string, string>;

const newDraft = (sortOrder: number): Draft => ({ version: 0, title: '', description: '', rewardCoins: 0, category: 'DAILY', conditionType: 'CHECKIN_COUNT', conditionTarget: 1, period: 'DAILY', isActive: false, sortOrder, startsAt: '', endsAt: '', reason: '' });

export function MissionManagement({ sessionActive, canManage, missions, onSaved }: { sessionActive: boolean; canManage: boolean; missions: Mission[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const savingRef = useRef(false);
  const [dirty, setDirty] = useState(false), [deleting, setDeleting] = useState<Mission | null>(null), [deleteReason, setDeleteReason] = useState('');
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDirty(true); setDraft(current => current ? { ...current, [key]: value } : current); };
  function edit(mission: Mission) {
    setError('');
    setDirty(false); setDraft({ id: mission.id, version: mission.version, title: mission.title, description: mission.description ?? '', rewardCoins: mission.rewardCoins, category: mission.category, conditionType: mission.conditionType, conditionTarget: mission.conditionTarget, period: mission.period, isActive: mission.isActive, sortOrder: mission.sortOrder, startsAt: toDateTimeLocalInput(mission.startsAt), endsAt: toDateTimeLocalInput(mission.endsAt), reason: '' });
  }
  async function save() {
    if (!draft || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError('');
    const body = { ...draft, startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null, endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null };
    try {
      const response = await fetch(draft.id ? `${API.admin.growth.missions}/${draft.id}` : API.admin.growth.missions, { method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setDraft(null); setDirty(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '任务保存失败。'); } finally { savingRef.current = false; setSaving(false); }
  }

  return (
    <>
      <AdminPanel
        className="border-border bg-card shadow-sm"
        aria-label="平台任务"
        title="平台任务"
        description="领取条件由服务器按签到、用户消息、公开帖子或评论核验；MANUAL 任务不能启用发奖。"
        badge={<Badge variant="outline">{missions.length} 个任务</Badge>}
        actions={canManage ? <Button size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => { setError(''); setDirty(false); setDraft(newDraft(missions.length)); }}>新建任务</Button> : undefined}
      >
        {!missions.length
          ? <AdminNotice tone="info" title="暂无平台任务。" />
          : <div className="space-y-3">{missions.map(mission => (
            <article key={mission.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-muted/20 p-4 transition-colors hover:border-brand/30 hover:bg-brand-soft/15">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{mission.title}</h3>
                  <Badge variant={mission.isActive ? 'success' : 'neutral'}>{mission.isActive ? '已启用' : '已停用'}</Badge>
                  <Badge variant="outline">{PERIOD_LABELS[mission.period] ?? mission.period}</Badge>
                </div>
                {mission.description && <p className="mt-1 text-sm text-muted-foreground">{mission.description}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  条件 {mission.conditionType} ≥ {mission.conditionTarget} · 奖励 {mission.rewardCoins} 金币{mission.startsAt ? ` · 开始 ${new Date(mission.startsAt).toLocaleString('zh-CN')}` : ''}{mission.endsAt ? ` · 结束 ${new Date(mission.endsAt).toLocaleString('zh-CN')}` : ''}
                </p>
              </div>
              {canManage && <div className="flex flex-wrap items-center gap-2">{!mission.isActive && <span className="text-xs text-muted-foreground">历史领取 {mission.referenceCount} 条</span>}<Button variant="outline" size="sm" leadingIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => edit(mission)}>编辑</Button>{!mission.isActive && mission.referenceCount === 0 && <Button variant="danger" size="sm" onClick={() => { setError(''); setDeleteReason(''); setDeleting(mission); }}>删除</Button>}</div>}
            </article>
          ))}</div>}
      </AdminPanel>
      <Dialog
        open={!!draft}
        onClose={() => { if (saving) return; if (dirty && !window.confirm('当前任务有未保存修改，确定关闭并放弃吗？')) return; setDirty(false); setDraft(null); }}
        title={draft?.id ? '编辑任务' : '新建任务'}
        description="保存后立即按新的核验条件发放，历史领取记录不受影响。"
        size="lg"
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={() => { if (saving) return; if (dirty && !window.confirm('当前任务有未保存修改，确定关闭并放弃吗？')) return; setDirty(false); setDraft(null); }}>取消</Button>
            <Button loading={saving} disabled={saving} onClick={() => void save()}>保存任务</Button>
          </>
        }
      >
        {draft && (
          <form id="mission-form" className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void save(); }}>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">任务名称</span>
              <Input maxLength={100} value={draft.title} onChange={e => change('title', e.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">分类</span>
              <Select aria-label="任务分类" value={draft.category} onChange={e => change('category', e.target.value)}>
                {CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">核验条件</span>
              <Select aria-label="核验条件" value={draft.conditionType} onChange={e => change('conditionType', e.target.value)}>
                {CONDITIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">目标数量</span>
              <Input type="number" min={1} max={10000} step={1} value={draft.conditionTarget} onChange={e => change('conditionTarget', Number(e.target.value))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">重复周期</span>
              <Select aria-label="重复周期" value={draft.period} onChange={e => change('period', e.target.value)}>
                {PERIODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">金币奖励</span>
              <Input type="number" min={0} max={10000} step={1} value={draft.rewardCoins} onChange={e => change('rewardCoins', Number(e.target.value))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">排序</span>
              <Input type="number" min={0} max={100000} value={draft.sortOrder} onChange={e => change('sortOrder', Number(e.target.value))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">开始时间（本地）</span>
              <Input type="datetime-local" value={draft.startsAt} onChange={e => change('startsAt', e.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">结束时间（本地）</span>
              <Input type="datetime-local" value={draft.endsAt} onChange={e => change('endsAt', e.target.value)} />
            </label>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} onChange={e => change('isActive', e.target.checked)} />
              启用任务
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium">任务说明</span>
              <Textarea rows={3} maxLength={1000} value={draft.description} onChange={e => change('description', e.target.value)} />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium">操作理由</span>
              <Input maxLength={500} value={draft.reason} onChange={e => change('reason', e.target.value)} />
            </label>
            {error && <div className="sm:col-span-2"><AdminNotice tone="error" title={error} /></div>}
          </form>
        )}
      </Dialog>
      <Dialog open={!!deleting} onClose={() => { if (!saving) setDeleting(null); }} title="删除已停用任务" description="仅允许删除没有任何用户领取记录的任务；删除后不可恢复。" size="md" footer={<><Button variant="ghost" disabled={saving} onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" loading={saving} disabled={saving || !deleteReason.trim()} onClick={async () => { if (!deleting) return; setSaving(true); setError(''); try { const response = await fetch(`${API.admin.growth.missions}/${encodeURIComponent(deleting.id)}`, {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({version: deleting.version, reason: deleteReason.trim()})}); const data = await response.json(); if (!response.ok) throw Error(data.error || '任务删除失败。'); setDeleting(null); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : '任务删除失败。'); } finally { setSaving(false); } }}>确认删除</Button></>}>
        {deleting && <p className="mb-3 text-sm text-muted-foreground">当前关联领取记录：{deleting.referenceCount} 条。</p>}{error && <AdminNotice tone="error" title={error} className="mb-3" />}<label className="block space-y-1.5"><span className="text-sm font-medium">删除理由</span><Textarea required maxLength={500} rows={3} value={deleteReason} onChange={event => setDeleteReason(event.target.value)} /></label>
      </Dialog>
    </>
  );
}
