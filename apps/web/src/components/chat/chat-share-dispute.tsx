'use client';
import {useEffect,useRef,useState} from 'react';
import {Flag,Share2} from 'lucide-react';
import {Dialog} from '@rumiai/ui';
import {apiFetch} from '@web/lib/api-client';
import {useAuth} from '@web/lib/auth-context';
import {API} from '@rumiai/contracts/api-paths';
import {DEFAULT_LOCALE} from '@web/lib/i18n';
import {useUiConfig} from '@web/lib/settings/use-ui-config';
import type {ConversationSharePreview} from '@rumiai/contracts/conversations/sharing';

export function ChatShareAndDispute({conversationId,disabled,onOpen,menu=false}:{conversationId:string;disabled:boolean;onOpen?:()=>void;menu?:boolean}) {
 const config=useUiConfig();
 const {token}=useAuth();
 const disputeEnabled=Object.keys(config).length===0 || config['dispute.enabled']===true;
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [preview,setPreview]=useState<ConversationSharePreview|null>(null),[selected,setSelected]=useState<string[]>([]),[url,setUrl]=useState('');
 const generation=useRef(0);
 useEffect(()=>{generation.current++;setOpen(false);setPreview(null);setSelected([]);setError('');setNotice('');setUrl('');setBusy(false);return()=>{generation.current++;};},[conversationId,token]);
 async function load() {
  const ticket=++generation.current;setBusy(true);setError('');
  try { const data=await apiFetch<ConversationSharePreview>(API.conversations.share(conversationId),{token,cache:'no-store'});
   if(ticket===generation.current){setPreview(data);setSelected(ids=>ids.filter(id=>data.messages.some(message=>message.id===id)));}
  }catch(e){if(ticket===generation.current)setError(e instanceof Error?e.message:'预览加载失败，请重试。');}
  finally{if(ticket===generation.current)setBusy(false);}
 }
 async function create() {
  const ticket=++generation.current;setBusy(true);setError('');setNotice('');
  try {
   const data=await apiFetch<{id:string;path:string;turnCount:number}>(API.conversations.share(conversationId),{token,method:'POST',body:JSON.stringify({confirmed:true,messageIds:selected,messageVersions:Object.fromEntries((preview?.messages??[]).filter(m=>selected.includes(m.id)).map(m=>[m.id,m.version]))})});
   if(ticket!==generation.current)return;
   const link=new URL(data.path,window.location.origin).href;setUrl(link);
   setNotice('所选 '+data.turnCount+' 条文字已生成固定分享；后续对话不会公开。');
   setPreview(p=>p?{...p,shares:[{id:data.id,createdAt:new Date().toISOString(),messageCount:data.turnCount},...p.shares]}:p);
  }catch(e){if(ticket===generation.current)setError(e instanceof Error?e.message:'创建失败，请重试。');}
  finally{if(ticket===generation.current)setBusy(false);}
 }
 async function revoke(id:string) {
  const ticket=++generation.current;setBusy(true);setError('');
  try {
   await apiFetch(API.conversations.share(conversationId),{token,method:'DELETE',body:JSON.stringify({shareId:id})});
   if(ticket!==generation.current)return;
   setPreview(p=>p?{...p,shares:p.shares.filter(s=>s.id!==id)}:p);
   if(url.endsWith('/'+id))setUrl('');
   setNotice('分享已撤销，原链接无法继续访问。');
  }catch(e){if(ticket===generation.current)setError(e instanceof Error?e.message:'撤销失败，请重试。');}
  finally{if(ticket===generation.current)setBusy(false);}
 }
 async function copy(link:string) {
  const ticket=generation.current;
  try{await navigator.clipboard.writeText(link);if(ticket===generation.current)setNotice('链接已复制。');}
  catch{if(ticket===generation.current){setUrl(link);setNotice('复制未获浏览器允许，请手动选择链接。');}}
 }
 return <div className="min-w-0">
  <div className={menu?"space-y-1":"flex flex-wrap items-center gap-2"}>
   <button type="button" disabled={disabled||busy||!token} onClick={()=>{onOpen?.();setOpen(true);void load();}} className={menu?"flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-secondary disabled:opacity-40":"inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-secondary disabled:opacity-40"}><Share2 aria-hidden className="h-4 w-4"/>分享与管理</button>
   <a onClick={onOpen} href={'/'+DEFAULT_LOCALE+'/disputes/new?conversationId='+encodeURIComponent(conversationId)} aria-disabled={!disputeEnabled||undefined} className={(menu?'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-[15px] ':'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm ')+(disputeEnabled?'hover:bg-secondary':'pointer-events-none text-muted-foreground')}><Flag aria-hidden className="h-4 w-4"/>评理</a>
  </div>
  <Dialog open={open} onClose={()=>setOpen(false)} title="选择分享的内容" description="只公开勾选的文字。图片、贴纸、私人备注和角色设定不会公开；来源文字修改或删除后链接失效。"
   footer={<><button type="button" onClick={()=>setOpen(false)} className="min-h-11 px-4">关闭</button><button type="button" disabled={busy||!selected.length} onClick={()=>void create()} className="min-h-11 rounded-full bg-brand px-4 text-brand-foreground disabled:opacity-40">{busy?'处理中…':'确认公开所选文字'}</button></>}>
   {error&&<p role="alert" className="mb-3 text-sm text-destructive">{error}<button type="button" disabled={busy} onClick={()=>void load()} className="ml-3 underline">重新加载</button></p>}
   {!preview&&!error&&<p role="status">正在加载预览…</p>}
   {preview&&<div className="space-y-4">
    <p className="text-sm text-muted-foreground">最近 {preview.maxMessages} 条文本中选择，当前已选 {selected.length} 条。</p>
    {!preview.messages.length&&<p className="text-sm">还没有可以分享的文字消息。</p>}
    <div className="max-h-72 space-y-2 overflow-y-auto">{preview.messages.map(m=><label key={m.id} className="flex cursor-pointer gap-3 rounded-xl border border-border p-3"><input type="checkbox" disabled={busy} checked={selected.includes(m.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,m.id]:ids.filter(id=>id!==m.id))} className="mt-1"/><span className="min-w-0"><span className="block text-xs text-muted-foreground">{m.role==='USER'?'我':'AI角色'}</span><span className="mt-1 block whitespace-pre-wrap break-words text-sm leading-6">{m.content}</span></span></label>)}</div>
    <section><h3 className="mb-2 text-sm font-medium">已创建的分享</h3>{!preview.shares.length?<p className="text-sm text-muted-foreground">暂无分享</p>:<ul className="space-y-2">{preview.shares.map(s=><li key={s.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="flex-1">{s.messageCount} 条 · {new Date(s.createdAt).toLocaleString()}</span><button type="button" onClick={()=>void copy(new URL('/share/chat/'+s.id,window.location.origin).href)} className="min-h-11 px-2 text-brand">复制链接</button><button type="button" disabled={busy} onClick={()=>void revoke(s.id)} className="min-h-11 px-2 text-destructive">撤销</button></li>)}</ul>}</section>
   </div>}
   {notice&&<p role="status" className="mt-3 text-sm">{notice}</p>}
   {url&&<a href={url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-brand underline">{url}</a>}
  </Dialog>
 </div>;
}
