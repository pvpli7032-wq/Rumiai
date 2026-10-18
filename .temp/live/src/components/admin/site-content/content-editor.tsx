'use client';
import {useEffect, useState, type FormEvent} from 'react';
import type {ContentStatus, ContentType, Revision, SiteContentRow} from './types';
import {PageBlockEditor} from './page-block-editor';
import {SiteBlocks} from '@/components/site-content/site-blocks';
import type {SitePageBlock} from '@/lib/use-site-content';

type Props = {type: ContentType; item: SiteContentRow | null; canManage: boolean; canPublish: boolean; busy: boolean; revisions: Revision[]; revisionLoading: boolean; onApply: (action: 'SAVE'|'SCHEDULE'|'PUBLISH'|'UNPUBLISH'|'DELETE_DRAFT', content: Record<string, unknown>, reason: string, scheduledAt?: string) => void; onRestore: (revision: Revision, reason: string) => void; onLoadRevisions: () => void; onClose: () => void};
const sourceOptions = [['FOR_YOU','为你推荐'],['EXCLUSIVE','独家角色'],['POPULAR','热门'],['NEWEST','最新发布'],['TAG','按分类']];
function fieldLabel(name: string) {return ({placement:'展示位置',kind:'页面类型',slug:'固定路径键',title:'标题',summary:'页面摘要',description:'说明',href:'站内跳转路径',gradientFrom:'渐变起点色',gradientTo:'渐变终点色',imageUrl:'站内图片',sortOrder:'排序值',isActive:'在前台显示',key:'稳定键',label:'显示名称',group:'分类分组',filterRow:'首页筛选行',emoji:'图标',source:'角色来源',tagKey:'关联分类',blocks:'页面组件',startsAt:'内容生效时间',endsAt:'内容结束时间',brandName:'品牌名称',logoUrl:'品牌图标',accentFrom:'品牌渐变起点',accentTo:'品牌渐变终点',footerNote:'页脚说明'} as Record<string,string>)[name] ?? name;}

export function ContentEditor({type, item, canManage, canPublish, busy, revisions, revisionLoading, onApply, onRestore, onLoadRevisions, onClose}: Props) {
  const [content, setContent] = useState<Record<string, unknown>>({}), [reason, setReason] = useState(''), [publishAt, setPublishAt] = useState(''), [error, setError] = useState('');
  useEffect(() => {setContent(item?.content ? {...item.content} : {}); setReason(''); setPublishAt(''); setError('');}, [type, item?.id, item?.version]);
  function set(name: string, value: unknown) {setContent(old => ({...old, [name]: value}));}
  function apply(action: 'SAVE'|'SCHEDULE'|'PUBLISH'|'UNPUBLISH'|'DELETE_DRAFT', event?: FormEvent) {
    event?.preventDefault(); setError('');
    if (!reason.trim()) {setError('请填写操作理由。'); return;}
    let scheduledAt: string | undefined;
    if (action === 'SCHEDULE') {
      const time = new Date(publishAt); if (!publishAt || !Number.isFinite(time.getTime())) {setError('请选择有效发布时间。'); return;}
      scheduledAt = time.toISOString();
    }
    onApply(action, content, reason.trim(), scheduledAt);
  }
  return <section className="space-y-4 rounded-xl border bg-card p-4 md:p-6" aria-label="站点内容编辑器">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{item ? '编辑内容' : '新增内容草稿'}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{item ? `编号 ${item.id} · 版本 ${item.version} · ${item.status}` : '当前内容未发布到前台'}</p></div><button type="button" onClick={onClose} className="min-h-11 rounded-lg border px-3">关闭</button></div>
    <form onSubmit={event => apply('SAVE', event)} className="space-y-4">
      {Object.entries(content).map(([name, value]) => <label key={name} className="block text-sm">{fieldLabel(name)}
        {name === 'isActive' ? <select value={String(value)} onChange={event => set(name, event.target.value === 'true')} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"><option value="true">显示</option><option value="false">隐藏</option></select>
        : name === 'placement' ? <select value={String(value)} onChange={event => set(name, event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3">{type==='BANNER'?<><option value="HERO">首页横幅</option><option value="SIDEBAR">侧栏横幅</option></>:<><option value="HEADER">顶部导航</option><option value="FOOTER">页脚链接</option></>}</select>
        : name === 'source' ? <select value={String(value)} onChange={event => set(name, event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3">{sourceOptions.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
        : name === 'kind' ? <select value={String(value)} onChange={event => set(name, event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"><option value="PAGE">固定页面</option><option value="ANNOUNCEMENT">站点公告</option></select>
        : name === 'filterRow' ? <select value={value == null ? '' : String(value)} onChange={event => set(name, event.target.value || null)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"><option value="">不显示在首页筛选</option><option value="type">类型</option><option value="role">题材</option></select>
        : name === 'imageUrl' ? <input value={value == null ? '' : String(value)} onChange={event => set(name, event.target.value || null)} maxLength={300} placeholder="可留空；只能使用站内品牌资源或站点素材" className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" />
        : name.startsWith('gradient') ? <input type="color" value={String(value)} onChange={event => set(name, event.target.value)} className="mt-1 h-11 w-full rounded-lg border bg-background p-1" />
        : name === 'blocks' ? <PageBlockEditor value={(Array.isArray(value)?value:[]) as SitePageBlock[]} onChange={blocks=>set(name,blocks)} />
        : name === 'startsAt' || name === 'endsAt' ? <input type="datetime-local" value={value?(()=>{const date=new Date(String(value));date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16);})():''} onChange={event=>set(name,event.target.value?new Date(event.target.value).toISOString():null)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" />
        : name === 'description' || name === 'summary' || name === 'footerNote' ? <textarea value={String(value ?? '')} maxLength={name==='description'?180:name==='footerNote'?240:240} onChange={event => set(name, event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border bg-background p-3" />
        : name === 'sortOrder' ? <input type="number" min={0} max={100000} step={1} value={String(value)} onChange={event => set(name, Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" />
        : <input value={String(value ?? '')} maxLength={name === 'href' ? 200 : 100} readOnly={name==='key'&&Boolean(item?.isPublished)} onChange={event => set(name, event.target.value)} className={`mt-1 min-h-11 w-full rounded-lg border bg-background px-3 ${name==='key'&&item?.isPublished?'cursor-not-allowed opacity-70':''}`} />}</label>)}
      {type === 'BANNER' && <div className="rounded-lg p-4 text-white" style={{background: `linear-gradient(135deg, ${String(content.gradientFrom)}, ${String(content.gradientTo)})`}}><p className="font-semibold">{String(content.title || '横幅预览')}</p><p className="mt-1 text-sm">{String(content.description || '横幅说明预览')}</p><p className="mt-2 text-xs opacity-80">跳转：{String(content.href || '/')}</p></div>}
      {type === 'NAVIGATION' && <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><span className="text-xs text-muted-foreground">导航预览</span><span className="min-h-11 inline-flex items-center rounded px-2" style={{backgroundImage:`linear-gradient(90deg,${String(content.accentFrom??'#EE4036')},${String(content.accentTo??'#FAAF40')})`,backgroundClip:'text',color:'transparent'}}>{String(content.label||'导航名称')}</span><span className="text-xs text-muted-foreground">{String(content.href||'/')}</span></div>}
      {type === 'BRANDING' && <div className="rounded-lg p-4 text-white" style={{background:`linear-gradient(135deg,${String(content.accentFrom)},${String(content.accentTo)})`}}><p className="text-lg font-bold">{String(content.brandName||'品牌名称预览')}</p><p className="mt-1 text-sm">{String(content.footerNote||'页脚说明预览')}</p></div>}
      {type === 'PAGE' && <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">页面预览 · /pages/{String(content.slug||'slug')}</p><h3 className="text-xl font-semibold">{String(content.title||'页面标题')}</h3>{Boolean(content.summary)&&<p className="mt-2 text-sm text-muted-foreground">{String(content.summary)}</p>}<SiteBlocks blocks={(Array.isArray(content.blocks)?content.blocks:[]) as SitePageBlock[]} previewPageId={item?.id||undefined} draftPreview /></div>}
      <label className="block text-sm">操作理由<textarea value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3" /></label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-wrap gap-2"><button disabled={busy||!canManage} className="min-h-11 rounded-lg border px-4">保存草稿</button>{canPublish&&<><button type="button" disabled={busy} onClick={()=>apply('PUBLISH')} className="min-h-11 rounded-lg bg-orange-600 px-4 text-white">立即发布</button><button type="button" disabled={busy} onClick={()=>apply('UNPUBLISH')} className="min-h-11 rounded-lg border px-4">下架</button></>}</div>
    </form>
    {canPublish && <div className="flex flex-wrap items-end gap-2 border-t pt-4"><label className="min-w-52 flex-1 text-sm">定时发布时间<input type="datetime-local" value={publishAt} onChange={event=>setPublishAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" /></label><button disabled={busy} onClick={()=>apply('SCHEDULE')} className="min-h-11 rounded-lg border px-4">保存并定时发布</button></div>}
    {item && (item.status==='DRAFT'||item.status==='SCHEDULED') && canManage && <div><button disabled={busy} onClick={()=>apply('DELETE_DRAFT')} className="min-h-11 rounded-lg border px-4 text-red-400">丢弃草稿</button></div>}
    {item && <div className="border-t pt-4"><button type="button" disabled={revisionLoading} onClick={onLoadRevisions} className="min-h-11 rounded-lg border px-4">{revisionLoading?'读取中…':'查看发布历史'}</button>{revisions.length>0&&<ol className="mt-3 space-y-2">{revisions.map(revision=><li key={revision.id} className="rounded-lg border p-3 text-sm"><p className="font-medium">版本 {revision.version} · {revision.actor.username}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString('zh-CN')} · {revision.reason}</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{JSON.stringify(revision.snapshot,null,2)}</pre>{canManage&&<button type="button" disabled={busy} onClick={()=>{if(!reason.trim()){setError('请填写恢复操作理由。');return;}onRestore(revision,reason);}} className="mt-2 min-h-11 rounded-lg border px-3">恢复为草稿</button>}</li>)}</ol>}</div>}
  </section>;
}
