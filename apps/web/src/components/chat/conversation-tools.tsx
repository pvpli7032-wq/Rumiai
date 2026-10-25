'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import Link from 'next/link';
import {Download,History,MoreHorizontal,Pencil,Pin,Trash2} from 'lucide-react';
import {Dialog} from '@rumiai/ui';
import {api,apiBlob} from '@web/lib/api-client';
import {notifyChatListChanged} from '@rumiai/contracts/conversations/chat-events';
import {ChatPanelSheet} from './chat-panel-sheet';
export function ConversationTools({conversationId,token,title,pinned,disabled,onDeleted,historyHref,extraActions,settingsActions}:{conversationId:string;token:string;title?:string;pinned?:boolean;disabled?:boolean;onDeleted:()=>void;historyHref?:string;extraActions?:(close:()=>void)=>ReactNode;settingsActions?:(close:()=>void)=>ReactNode}){
 const [tab,setTab]=useState<'chat'|'settings'>('chat');
 const [open,setOpen]=useState(false),[mode,setMode]=useState<'rename'|'delete'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[name,setName]=useState(title||''),[isPinned,setPinned]=useState(Boolean(pinned)),[mounted,setMounted]=useState(false);
 useEffect(()=>setMounted(true),[]);
 useEffect(()=>{setPinned(Boolean(pinned));setName(title||'');setOpen(false);setMode(null);setError('');},[conversationId,title,pinned]);
 async function show(){setTab('chat');setOpen(true);setError('');if(pinned===undefined)try{const data=await api.get<{conversation:{pinnedAt?:string|null;title?:string|null}}>('/api/conversations/'+conversationId,{token});setPinned(Boolean(data.conversation.pinnedAt));setName(data.conversation.title||title||'');}catch(cause){setError(cause instanceof Error?cause.message:'读取会话失败。');}}
 async function download(format:'json'|'txt'){setBusy(true);setError('');try{const blob=await apiBlob('/api/conversations/'+conversationId+'/export?format='+format,{token}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='xingban-chat-'+conversationId+'.'+format;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setOpen(false);}catch(cause){setError(cause instanceof Error?cause.message:'导出失败。');}finally{setBusy(false);}}
 async function pin(){setBusy(true);setError('');try{await api.patch('/api/conversations/'+conversationId,{pinned:!isPinned},{token});setPinned(!isPinned);notifyChatListChanged();setOpen(false);}catch(cause){setError(cause instanceof Error?cause.message:'置顶失败。');}finally{setBusy(false);}}
 async function submit(){setBusy(true);setError('');try{if(mode==='delete'){await api.del('/api/conversations/'+conversationId,{token});setMode(null);notifyChatListChanged();onDeleted();}else{await api.patch('/api/conversations/'+conversationId,{title:name},{token});setMode(null);notifyChatListChanged();}}catch(cause){setError(cause instanceof Error?cause.message:'操作失败。');}finally{setBusy(false);}}
 const row='flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40';
 return <div className="shrink-0"><button type="button" aria-label="更多对话操作" aria-expanded={open} disabled={disabled||busy} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>void show()}><MoreHorizontal size={19}/></button>
 {mounted&&createPortal(<><ChatPanelSheet open={open} onClose={()=>setOpen(false)} title={settingsActions?"聊天与设置":"对话操作"} size={settingsActions?"half":"content"}>{settingsActions&&<div role="tablist" aria-label="聊天菜单分类" className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-secondary p-1">{([ ["chat","聊天"],["settings","设置"] ] as const).map(([key,label])=><button type="button" role="tab" key={key} aria-selected={tab===key} className={"min-h-11 rounded-full text-[15px] transition-colors motion-reduce:transition-none "+(tab===key?"bg-background text-foreground":"text-muted-foreground")} onClick={()=>setTab(key)}>{label}</button>)}</div>}<div role={settingsActions?"tabpanel":undefined} aria-label={tab==="chat"?"聊天":"设置"} className="space-y-1">{settingsActions&&tab==="settings"?settingsActions(()=>setOpen(false)):<>
 {extraActions?.(()=>setOpen(false))}
 {historyHref&&<Link href={historyHref} className={row} onClick={()=>setOpen(false)}><History size={18}/>查看历史</Link>}
 <button type="button" className={row} disabled={busy} onClick={()=>{setOpen(false);setError('');setMode('rename');}}><Pencil size={18}/>重命名对话</button>
 <button type="button" className={row} disabled={busy} onClick={()=>void pin()}><Pin size={18}/>{isPinned?'取消置顶':'置顶对话'}</button>
 <button type="button" className={row} disabled={busy} onClick={()=>void download('json')}><Download size={18}/>导出 JSON</button>
 <button type="button" className={row} disabled={busy} onClick={()=>void download('txt')}><Download size={18}/>导出文本</button>
 <button type="button" className={row+' text-destructive'} disabled={busy} onClick={()=>{setOpen(false);setError('');setMode('delete');}}><Trash2 size={18}/>删除对话</button>
 </>}{error&&<p role="alert" className="px-3 pt-2 text-sm text-destructive">{error}</p>}</div></ChatPanelSheet>
 <Dialog open={mode!==null} onClose={()=>{if(!busy)setMode(null);}} title={mode==='rename'?'重命名对话':'删除这段对话？'} footer={<><button type="button" disabled={busy} className="min-h-11 rounded-full border border-border px-4 text-sm" onClick={()=>setMode(null)}>取消</button><button type="button" disabled={busy||mode==='rename'&&!name.trim()} className={'min-h-11 rounded-full px-4 text-sm disabled:opacity-40 '+(mode==='delete'?'bg-destructive text-white':'bg-brand text-brand-foreground')} onClick={()=>void submit()}>{busy?'处理中…':mode==='rename'?'保存名称':'确认删除'}</button></>}>
 {mode==='rename'?<label className="block space-y-2 text-sm"><span>对话名称</span><input aria-label="对话名称" value={name} onChange={event=>setName(event.target.value)} className="web-control w-full rounded-xl px-3 py-2"/></label>:<p className="text-sm leading-6 text-muted-foreground">对话、所有消息、关联记忆和分享将删除，无法恢复。举报、AI调用及账务记录按规则保留；删除不会自动退款。</p>}
 {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}</Dialog></>,document.body)}</div>;
}
