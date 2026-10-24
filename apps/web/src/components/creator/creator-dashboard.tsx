'use client';

import Link from 'next/link';
import Image from 'next/image';
import {useCallback, useEffect, useState} from 'react';
import {ArrowUpRight, ChevronRight, FileText, Info, Plus} from 'lucide-react';
import {useAuth} from '@web/lib/auth-context';
import {DRAFT_KEY} from './creator-draft';
import {characterPublicationLabel} from './publication-status';

type Role={id:string;name:string;tagline:string;avatarUrl?:string|null;reviewStatus:string;isPublic:boolean;publicationRequested:boolean};
type LocalDraft={key:string;name:string;tagline:string;avatarUrl:string;href:string};

function readDrafts():LocalDraft[] {
  const drafts:LocalDraft[]=[];
  for (let index=0;index<localStorage.length;index++) {
    const key=localStorage.key(index);
    if (!key || (key!==DRAFT_KEY && !key.startsWith(`${DRAFT_KEY}:edit:`))) continue;
    try {
      const value:unknown=JSON.parse(localStorage.getItem(key)||'null');
      if (!value || typeof value!=='object' || Array.isArray(value)) continue;
      const row=value as Record<string,unknown>;
      const editId=key===DRAFT_KEY ? '' : key.slice(`${DRAFT_KEY}:edit:`.length);
      if (key!==DRAFT_KEY && !editId) continue;
      drafts.push({key,name:typeof row.name==='string' ? row.name : '',tagline:typeof row.tagline==='string' ? row.tagline : '',avatarUrl:typeof row.avatarUrl==='string' ? row.avatarUrl : '',href:editId ? `/creator?edit=${encodeURIComponent(editId)}` : '/creator?new=1'});
    } catch { /* A malformed local record is not a resumable draft. */ }
  }
  return drafts;
}


function DraftCard({draft}:{draft:LocalDraft}) {
  return <article className="flex min-w-0 gap-3 rounded-[20px] border border-border bg-card p-3">
    <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-2xl bg-secondary sm:w-28">{draft.avatarUrl ? <img src={draft.avatarUrl} alt="" className="h-full w-full object-cover" onError={event=>{event.currentTarget.style.display='none';}} /> : <Image src="/illustrations/still-life-writing-table-v1.png" alt="" fill sizes="(max-width: 640px) 96px, 112px" className="object-cover" />}</div>
    <div className="flex min-w-0 flex-1 flex-col"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-[17px] font-semibold">{draft.name||'未命名角色'}</h3><span className="rounded-full bg-action/10 px-2 py-0.5 text-[11px] text-foreground">草稿</span></div><p className="mt-1 text-[11px] text-muted-foreground">保存在此设备</p><p className="mt-2 line-clamp-2 break-words text-[13px] leading-5 text-muted-foreground">{draft.tagline||'继续完善设定，让角色慢慢成形。'}</p><Link href={draft.href} className="mt-auto inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-brand">继续编辑 <ArrowUpRight className="h-4 w-4" /></Link></div>
  </article>;
}

/** Extends the supplied Creator first draft with real works and device drafts. */
export function CreatorDashboard() {
  const {token,isLoading}=useAuth();
  const [roles,setRoles]=useState<Role[]>([]);
  const [drafts,setDrafts]=useState<LocalDraft[]>([]);
  const [draftError,setDraftError]=useState('');
  const [tab,setTab]=useState<'roles'|'drafts'>('roles');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const refreshDrafts=useCallback(()=>{try{setDrafts(readDrafts());setDraftError('');}catch{setDraftError('此设备的草稿暂时无法读取，请重新打开或在编辑器中查看。');}},[]);
  useEffect(()=>{refreshDrafts();window.addEventListener('focus',refreshDrafts);window.addEventListener('storage',refreshDrafts);return()=>{window.removeEventListener('focus',refreshDrafts);window.removeEventListener('storage',refreshDrafts);};},[refreshDrafts]);
  useEffect(()=>{
    if (isLoading) return;
    if (!token) {setRoles([]);setError('');setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');
    fetch('/api/characters?scope=mine',{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then(async response=>{if(!response.ok)throw Error('作品暂时无法读取。');const rows:unknown=await response.json();if(!Array.isArray(rows))throw Error('作品暂时无法读取。');if(!controller.signal.aborted)setRoles(rows as Role[]);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'作品暂时无法读取。');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[token,isLoading,revision]);

  return <main className="mx-auto w-full max-w-6xl space-y-5 px-4 pb-6 pt-2 sm:px-6">
    <div className="flex justify-end"><button type="button" onClick={()=>setTab('drafts')} aria-pressed={tab==='drafts'} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground"><FileText className="h-5 w-5" />查看草稿箱{drafts.length>0?` (${drafts.length})`:''}</button></div>
    <section className="relative isolate min-h-48 overflow-hidden rounded-[24px] border border-border bg-secondary">
      <div className="absolute inset-y-0 right-0 w-3/5"><Image src="/illustrations/still-life-writing-table-v1.png" alt="" fill priority sizes="(max-width: 1152px) 60vw, 700px" className="object-cover" /></div>
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-transparent" />
      <div className="relative z-10 max-w-[78%] px-5 py-6 sm:max-w-lg sm:p-8"><h1 className="text-[26px] font-bold leading-snug tracking-tight sm:text-3xl">把你的想象，<br />写成一个角色。</h1><Link href="/creator?new=1" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-5 text-[15px] font-semibold text-brand-foreground"><Plus className="h-5 w-5" />创建角色</Link></div>
    </section>
    <div role="group" aria-label="创作内容" className="flex items-center gap-7">{([['roles','我的角色'],['drafts','草稿箱']] as const).map(([key,label])=><button key={key} type="button" onClick={()=>setTab(key)} aria-pressed={tab===key} className={`relative min-h-11 pb-2 text-[18px] font-semibold ${tab===key?'text-foreground after:absolute after:bottom-0 after:left-1/2 after:h-[3px] after:w-5 after:-translate-x-1/2 after:rounded-full after:bg-action':'text-muted-foreground'}`}>{label}</button>)}</div>
    {draftError && <div role="alert" className="rounded-2xl border border-border bg-card p-4 text-sm"><p>{draftError}</p><button type="button" onClick={refreshDrafts} className="mt-2 min-h-11 text-brand">重新读取草稿</button></div>}
    {tab==='drafts' ? <section aria-label="本地草稿"><p className="mb-3 text-xs text-muted-foreground">仅显示当前设备保存的创作草稿。</p>{drafts.length ? <div className="space-y-3">{drafts.map(draft=><DraftCard key={draft.key} draft={draft} />)}</div> : !draftError && <div className="rounded-[20px] border border-dashed border-border bg-card px-5 py-8 text-center"><FileText className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 font-semibold">暂无草稿</h2><p className="mt-2 text-sm text-muted-foreground">开始写下角色设定，编辑器会自动保存。</p><Link href="/creator?new=1" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand">创建角色 <ArrowUpRight className="ml-1 h-4 w-4" /></Link></div>}</section> : <>
      {drafts.length>0 && <section className="space-y-3 rounded-[24px] bg-secondary/60 p-3"><div className="flex items-center justify-between gap-2 px-1"><h2 className="text-[18px] font-semibold">继续创作</h2><button type="button" onClick={()=>setTab('drafts')} className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground">查看全部 <ChevronRight className="h-4 w-4" /></button></div><DraftCard draft={drafts[0]} /></section>}
      <section><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><h2 className="text-[18px] font-semibold">我的作品</h2>{!loading && !error && token && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{roles.length}</span>}</div><Link href="/my-characters" className="inline-flex min-h-11 items-center text-[13px] text-brand">管理作品 <ChevronRight className="h-4 w-4" /></Link></div>
      {isLoading||loading ? <p role="status" className="py-6 text-sm text-muted-foreground">正在读取作品…</p> : !token ? <div className="rounded-[20px] border border-border bg-card p-5 text-sm"><p className="text-muted-foreground">登录后可管理你的作品；此设备的草稿仍可继续编辑。</p><Link href="/login?next=/creator" className="mt-2 inline-flex min-h-11 items-center text-brand">登录</Link></div> : error ? <div role="alert" className="rounded-[20px] border border-destructive/30 bg-card p-5 text-sm"><p>{error}</p><button type="button" onClick={()=>setRevision(value=>value+1)} className="mt-2 min-h-11 text-brand">重新读取</button></div> : !roles.length ? <div className="rounded-[20px] border border-dashed border-border bg-card p-6"><h3 className="font-semibold">还没有作品</h3><p className="mt-2 text-sm text-muted-foreground">从一个名字、一句开场白开始。</p><Link href="/creator?new=1" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand">创建第一个角色 <ArrowUpRight className="ml-1 h-4 w-4" /></Link></div> : <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">{roles.map(role=><li key={role.id} className="min-w-0 overflow-hidden rounded-[20px] border border-border bg-card"><Link href={`/creator?edit=${encodeURIComponent(role.id)}`} aria-label={`编辑角色 ${role.name}`} className="block focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><div className="relative aspect-square overflow-hidden bg-secondary"><span className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-brand">{role.name.slice(0,1)||'✦'}</span>{role.avatarUrl && <img src={role.avatarUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={event=>{event.currentTarget.style.display='none';}} />}</div><div className="space-y-2 p-3"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="min-w-0 break-words text-[15px] font-semibold">{role.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] text-foreground ${role.isPublic?'bg-secondary':role.reviewStatus==='REJECTED'?'bg-destructive/10':'bg-muted'}`}>{characterPublicationLabel(role)}</span></div><p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{role.tagline||'尚未添加一句话简介。'}</p><span className="inline-flex min-h-11 items-center text-xs font-medium text-brand">继续编辑 <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></span></div></Link></li>)}</ul>}</section>
    </>}
    <aside className="flex flex-wrap items-center gap-2 rounded-2xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground"><Info className="h-4 w-4 shrink-0" /><p className="min-w-0 flex-1">角色公开前需通过内容审核。</p><Link href="/zh/terms-and-policy" className="inline-flex min-h-11 items-center font-medium text-brand">查看内容规范 <ChevronRight className="h-4 w-4" /></Link></aside>
  </main>;
}
