'use client';

import { Eye, History, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ContentType, Revision, SiteContentRow } from './types';
import { PageBlockEditor } from './page-block-editor';
import { SiteBlocks } from '@/components/site-content/site-blocks';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { SitePageBlock } from '@/lib/use-site-content';
import { DEFAULT_ACCENT_FROM, DEFAULT_ACCENT_TO } from '@/lib/site-content/brand-defaults';

type Action = 'SAVE' | 'SCHEDULE' | 'PUBLISH' | 'UNPUBLISH' | 'DELETE_DRAFT';
type Props = { type: ContentType; item: SiteContentRow | null; canManage: boolean; canPublish: boolean; busy: boolean; revisions: Revision[]; revisionLoading: boolean; onApply: (action: Action, content: Record<string, unknown>, reason: string, scheduledAt?: string) => void; onRestore: (revision: Revision, reason: string) => void; onLoadRevisions: () => void; onClose: () => void };

const sourceOptions = [['FOR_YOU', '为你推荐'], ['EXCLUSIVE', '独家角色'], ['POPULAR', '热门'], ['NEWEST', '最新发布'], ['TAG', '按分类']];
const fieldLabel = (name: string) => ({ placement: '展示位置', kind: '页面类型', slug: '固定路径键', title: '标题', summary: '页面摘要', description: '说明', href: '站内跳转路径', gradientFrom: '渐变起点色', gradientTo: '渐变终点色', imageUrl: '站内图片', sortOrder: '排序值', isActive: '在前台显示', key: '稳定键', label: '显示名称', group: '分类分组', filterRow: '首页筛选行', emoji: '图标', source: '角色来源', tagKey: '关联分类', blocks: '页面组件', startsAt: '内容生效时间', endsAt: '内容结束时间', brandName: '品牌名称', logoUrl: '品牌图标', accentFrom: '品牌渐变起点', accentTo: '品牌渐变终点', footerNote: '页脚说明' } as Record<string, string>)[name] ?? name;
const localTime = (value: unknown) => {
  if (!value) return '';
  const date = new Date(String(value)); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export function ContentEditor({ type, item, canManage, canPublish, busy, revisions, revisionLoading, onApply, onRestore, onLoadRevisions, onClose }: Props) {
  const [content, setContent] = useState<Record<string, unknown>>({}), [reason, setReason] = useState(''), [publishAt, setPublishAt] = useState(''), [error, setError] = useState('');
  useEffect(() => { setContent(item?.content ? { ...item.content } : {}); setReason(''); setPublishAt(''); setError(''); }, [type, item?.id, item?.version]);
  function set(name: string, value: unknown) { setContent(old => ({ ...old, [name]: value })); }
  function apply(action: Action, event?: FormEvent) {
    event?.preventDefault(); setError('');
    if (!reason.trim()) { setError('请填写操作理由。'); return; }
    let scheduledAt: string | undefined;
    if (action === 'SCHEDULE') {
      const time = new Date(publishAt);
      if (!publishAt || !Number.isFinite(time.getTime())) { setError('请选择有效发布时间。'); return; }
      scheduledAt = time.toISOString();
    }
    onApply(action, content, reason.trim(), scheduledAt);
  }
  function field(name: string, value: unknown) {
    const label = fieldLabel(name);
    if (name === 'isActive') {
      return (
        <label className="block space-y-1.5" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Select aria-label={label} value={String(value)} onChange={event => set(name, event.target.value === 'true')}>
            <option value="true">显示</option><option value="false">隐藏</option>
          </Select>
        </label>
      );
    }
    if (name === 'placement') {
      return (
        <label className="block space-y-1.5" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Select aria-label={label} value={String(value)} onChange={event => set(name, event.target.value)}>
            {type === 'BANNER'
              ? <><option value="HERO">首页横幅</option><option value="SIDEBAR">侧栏横幅</option></>
              : <><option value="HEADER">顶部导航</option><option value="FOOTER">页脚链接</option></>}
          </Select>
        </label>
      );
    }
    if (name === 'source') {
      return (
        <label className="block space-y-1.5" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Select aria-label={label} value={String(value)} onChange={event => set(name, event.target.value)}>
            {sourceOptions.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </Select>
        </label>
      );
    }
    if (name === 'kind') {
      return (
        <label className="block space-y-1.5" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Select aria-label={label} value={String(value)} onChange={event => set(name, event.target.value)}>
            <option value="PAGE">固定页面</option><option value="ANNOUNCEMENT">站点公告</option>
          </Select>
        </label>
      );
    }
    if (name === 'filterRow') {
      return (
        <label className="block space-y-1.5" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Select aria-label={label} value={value == null ? '' : String(value)} onChange={event => set(name, event.target.value || null)}>
            <option value="">不显示在首页筛选</option><option value="type">类型</option><option value="role">题材</option>
          </Select>
        </label>
      );
    }
    if (name === 'blocks') {
      return (
        <div className="space-y-1.5 md:col-span-2" key={name}>
          <p className="text-sm font-medium">{label}</p>
          <PageBlockEditor value={(Array.isArray(value) ? value : []) as SitePageBlock[]} onChange={blocks => set(name, blocks)} />
        </div>
      );
    }
    if (name === 'startsAt' || name === 'endsAt') {
      return (
        <label className="block space-y-1.5" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Input type="datetime-local" value={localTime(value)} onChange={event => set(name, event.target.value ? new Date(event.target.value).toISOString() : null)} />
        </label>
      );
    }
    if (name === 'description' || name === 'summary' || name === 'footerNote') {
      return (
        <label className="block space-y-1.5 md:col-span-2" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Textarea rows={3} maxLength={name === 'description' ? 180 : 240} value={String(value ?? '')} onChange={event => set(name, event.target.value)} />
        </label>
      );
    }
    if (name === 'sortOrder') {
      return (
        <label className="block space-y-1.5" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Input type="number" min={0} max={100000} step={1} value={String(value)} onChange={event => set(name, Number(event.target.value))} />
        </label>
      );
    }
    if (name.startsWith('gradient')) {
      return (
        <label className="block space-y-1.5" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Input type="color" className="h-11 p-1" value={String(value)} onChange={event => set(name, event.target.value)} />
        </label>
      );
    }
    if (name === 'imageUrl') {
      return (
        <label className="block space-y-1.5 md:col-span-2" key={name}>
          <span className="text-sm font-medium">{label}</span>
          <Input maxLength={300} placeholder="可留空；只能使用站内品牌资源或站点素材" value={value == null ? '' : String(value)} onChange={event => set(name, event.target.value || null)} />
        </label>
      );
    }
    const locked = name === 'key' && Boolean(item?.isPublished);
    return (
      <label className="block space-y-1.5" key={name}>
        <span className="text-sm font-medium">{label}</span>
        <Input maxLength={name === 'href' ? 200 : 100} readOnly={locked} className={locked ? 'cursor-not-allowed opacity-70' : undefined} value={String(value ?? '')} onChange={event => set(name, event.target.value)} />
      </label>
    );
  }

  return (
    <AdminPanel
      title={item ? '编辑内容' : '新增内容草稿'}
      description={item ? `编号 ${item.id} · 版本 ${item.version}` : '当前内容未发布到前台'}
      badge={item ? <Badge variant={item.status === 'PUBLISHED' ? 'success' : item.status === 'SCHEDULED' ? 'warning' : 'neutral'}>{item.status}</Badge> : undefined}
      actions={<Button variant="ghost" size="sm" leadingIcon={<X className="h-4 w-4" />} onClick={onClose}>关闭</Button>}
    >
      <div className="space-y-5">
        <form onSubmit={event => apply('SAVE', event)} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(content).map(([name, value]) => field(name, value))}
          </div>
          {type === 'BANNER' && (
            <div className="rounded-lg p-4 text-white" style={{ background: `linear-gradient(135deg, ${String(content.gradientFrom)}, ${String(content.gradientTo)})` }}>
              <p className="font-semibold">{String(content.title || '横幅预览')}</p>
              <p className="mt-1 text-sm">{String(content.description || '横幅说明预览')}</p>
              <p className="mt-2 text-xs opacity-80">跳转：{String(content.href || '/')}</p>
            </div>
          )}
          {type === 'NAVIGATION' && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <span className="text-xs text-muted-foreground">导航预览</span>
              <span className="inline-flex min-h-11 items-center rounded px-2" style={{ backgroundImage: `linear-gradient(90deg,${String(content.accentFrom ?? DEFAULT_ACCENT_FROM)},${String(content.accentTo ?? DEFAULT_ACCENT_TO)})`, backgroundClip: 'text', color: 'transparent' }}>{String(content.label || '导航名称')}</span>
              <span className="text-xs text-muted-foreground">{String(content.href || '/')}</span>
            </div>
          )}
          {type === 'BRANDING' && (
            <div className="rounded-lg p-4 text-white" style={{ background: `linear-gradient(135deg,${String(content.accentFrom)},${String(content.accentTo)})` }}>
              <p className="text-lg font-bold">{String(content.brandName || '品牌名称预览')}</p>
              <p className="mt-1 text-sm">{String(content.footerNote || '页脚说明预览')}</p>
            </div>
          )}
          {type === 'PAGE' && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">页面预览 · /pages/{String(content.slug || 'slug')}</p>
              <h3 className="text-xl font-semibold">{String(content.title || '页面标题')}</h3>
              {Boolean(content.summary) && <p className="mt-2 text-sm text-muted-foreground">{String(content.summary)}</p>}
              <SiteBlocks blocks={(Array.isArray(content.blocks) ? content.blocks : []) as SitePageBlock[]} previewPageId={item?.id || undefined} draftPreview />
            </div>
          )}
          <div className="space-y-4 border-t border-border pt-5">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">操作理由</span>
              <Textarea rows={3} required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
            </label>
            {error && <AdminNotice tone="error" title={error} />}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline" disabled={busy || !canManage}>保存草稿</Button>
              {canPublish && (
                <>
                  <Button disabled={busy} onClick={() => apply('PUBLISH')}>立即发布</Button>
                  <Button variant="outline" disabled={busy} onClick={() => apply('UNPUBLISH')}>下架</Button>
                </>
              )}
            </div>
          </div>
        </form>
        {canPublish && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-5">
            <label className="block min-w-64 flex-1 space-y-1.5">
              <span className="text-sm font-medium">定时发布时间</span>
              <Input type="datetime-local" value={publishAt} onChange={event => setPublishAt(event.target.value)} />
            </label>
            <Button variant="outline" disabled={busy} onClick={() => apply('SCHEDULE')}>保存并定时发布</Button>
          </div>
        )}
        {item && (item.status === 'DRAFT' || item.status === 'SCHEDULED') && canManage && (
          <div className="border-t border-border pt-5">
            <Button variant="ghost" className="text-destructive" leadingIcon={<Trash2 className="h-4 w-4" />} disabled={busy} onClick={() => apply('DELETE_DRAFT')}>丢弃草稿</Button>
          </div>
        )}
        {item && (
          <div className="space-y-3 border-t border-border pt-5">
            <Button variant="outline" size="sm" leadingIcon={<History className="h-4 w-4" />} loading={revisionLoading} onClick={onLoadRevisions}>查看发布历史</Button>
            {revisions.length > 0 && (
              <ol className="space-y-3">
                {revisions.map(revision => (
                  <li key={revision.id} className="rounded-lg border border-border p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">版本 {revision.version} · {revision.actor.username}</p>
                      <p className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString('zh-CN')} · {revision.reason}</p>
                    </div>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{JSON.stringify(revision.snapshot, null, 2)}</pre>
                    {canManage && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        leadingIcon={<RotateCcw className="h-3.5 w-3.5" />}
                        disabled={busy}
                        onClick={() => { if (!reason.trim()) { setError('请填写恢复操作理由。'); return; } onRestore(revision, reason); }}
                      >
                        恢复为草稿
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><Eye aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />预览区域只反映当前草稿，不直接改动前台内容。</p>
      </div>
    </AdminPanel>
  );
}
