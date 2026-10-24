 'use client';
import { useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { notifyChatListChanged } from '@rumiai/contracts/conversations/chat-events';
import { zhError } from '@rumiai/contracts/copy/zh';
export function ConversationTools({conversationId,token,title,disabled,onDeleted,historyHref}:{conversationId:string;token:string;title?:string;disabled?:boolean;onDeleted:()=>void;historyHref?:string}){
 const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false);
 async function download(format:'json'|'txt'){
  setBusy(true);setError('');try{
   const response=await fetch(`/api/conversations/${conversationId}/export?format=${format}`,{headers:{Authorization:'Bearer '+token}});
   if(!response.ok){const data=await response.json();throw Error(zhError(data.error)||'导出失败。');}
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`xingban-chat-${conversationId}.${format}`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof TypeError?'网络连接失败，请重试。':(e as Error).message||'操作失败，请重试。')}finally{setBusy(false)}
 }
 async function remove(){setBusy(true);setError('');try{
  const response=await fetch('/api/conversations/'+conversationId,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
  if(!response.ok){const data=await response.json();throw Error(zhError(data.error)||'删除失败。');}
  setConfirm(false);notifyChatListChanged();onDeleted();
 }catch(e){setError(e instanceof TypeError?'网络连接失败，请重试。':(e as Error).message||'操作失败，请重试。')}finally{setBusy(false)}}
 const classes='min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40';
 return <div className="relative shrink-0"><button type="button" aria-label="更多对话操作" aria-expanded={open} disabled={disabled||busy} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40" onClick={()=>setOpen(value=>!value)}><MoreHorizontal className="h-5 w-5" /></button>{open&&<div className="absolute right-0 z-30 mt-1 flex w-36 flex-col rounded-xl border border-border bg-card p-1 shadow-lg">{historyHref&&<Link href={historyHref} onClick={()=>setOpen(false)} className="min-h-11 rounded-lg px-3 py-2 text-sm hover:bg-accent">查看历史</Link>}<button disabled={disabled||busy} className={classes+' border-0 text-left'} onClick={()=>void download('json')}>导出 JSON</button><button disabled={disabled||busy} className={classes+' border-0 text-left'} onClick={()=>void download('txt')}>导出文本</button><button disabled={disabled||busy} className={classes+' border-0 text-left text-destructive'} onClick={()=>{setError('');setOpen(false);setConfirm(true)}}>删除对话</button></div>}{error&&!confirm&&<p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}{confirm&&<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"><section role="alertdialog" aria-modal="true" aria-label="删除对话确认" className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-5"><h2 className="font-bold">删除这段对话？</h2>{title&&<p className="break-words">{title}</p>}<p className="text-sm text-muted-foreground">本段对话及所有消息将被删除，无法恢复。已提交的举报保留用于处理，AI 调用次数不返还。</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex gap-3"><button className={classes} disabled={busy} onClick={()=>setConfirm(false)}>取消</button><button className={classes+' text-destructive'} disabled={busy} onClick={remove}>{busy?'正在删除…':'确认删除'}</button></div></section></div>}</div>
}
