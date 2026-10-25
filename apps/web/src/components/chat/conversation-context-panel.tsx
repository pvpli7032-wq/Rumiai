'use client';
import {useEffect, useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {api} from '@web/lib/api-client';
import {ChatPanelSheet} from './chat-panel-sheet';
import {PersonaManager} from './persona-manager';
import {WorldbookManager} from './worldbook-manager';
import {RelationshipPanel} from './relationship-panel';
import {MemoryPanel} from './memory-panel';
import {ProactivePreferences} from '@web/components/profile/proactive-preferences';
import type {ConversationToolSettings} from '@rumiai/contracts/conversations/context-tools';
type View = 'settings' | 'personas' | 'worldbooks' | 'usage' | 'proactive' | 'relationship' | 'memory';
type Usage = {createdAt: string; sources: {sources: Array<{kind: string; id: string; label: string}>; truncated: boolean; memoryFactIds?: string[]}} | null;
export function ConversationContextPanel({open,onClose,conversationId,token,data,error,busy,reload,save,onArchived}: {
  open:boolean;onClose:()=>void;conversationId:string;token:string;data:ConversationToolSettings|null;error:string;busy:boolean;reload:()=>void;save:(settings:ConversationToolSettings['settings'])=>Promise<boolean>;onArchived?:()=>void;
}) {
  const [view,setView]=useState<View>('settings'),[draft,setDraft]=useState<ConversationToolSettings['settings']|null>(null),[dirty,setDirty]=useState(false);
  const [usage,setUsage]=useState<Usage>(null),[usageError,setUsageError]=useState(''),[usageLoading,setUsageLoading]=useState(false);
  useEffect(()=>{if(data&&!dirty)setDraft(data.settings);},[data,dirty]);
  useEffect(()=>{setView('settings');setDirty(false);setDraft(null);},[conversationId]);
  useEffect(()=>{
    if(!open||view!=='usage')return;const controller=new AbortController();setUsageLoading(true);setUsageError('');
    void api.get<Usage>('/api/conversations/'+conversationId+'/context/usage',{token,signal:controller.signal}).then(setUsage).catch(cause=>{if(!controller.signal.aborted)setUsageError(cause instanceof Error?cause.message:'读取失败。');}).finally(()=>{if(!controller.signal.aborted)setUsageLoading(false);});
    return()=>controller.abort();
  },[open,view,conversationId,token]);
  function change(value:Partial<ConversationToolSettings['settings']>){setDraft(current=>current?{...current,...value}:current);setDirty(true);}
  const title=view==='relationship'?'对话关系':view==='memory'?'角色记忆':view==='settings'?'对话设置':view==='personas'?'身份档案':view==='worldbooks'?'世界书':view==='proactive'?'主动问候':'本轮参考了什么';
  const control='web-control w-full rounded-xl px-3 py-2 text-sm';
  return <ChatPanelSheet open={open} onClose={()=>{if(!dirty||window.confirm('设置尚未保存，确认关闭并保留当前编辑状态？'))onClose();}} title={title}>
    <div className="space-y-5">
      {view!=='settings'&&<button type="button" className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground" onClick={()=>setView('settings')}><ChevronLeft size={16}/>返回对话设置</button>}
      {view==='personas'&&<PersonaManager token={token} onChanged={reload}/>}
      {view==='worldbooks'&&data&&<WorldbookManager token={token} characterId={data.characterId} canBindCharacter={data.canBindCharacterBooks} onChanged={reload}/>}
      {view==='relationship'&&<div className="[&>aside]:!block [&>aside]:!w-full [&>aside]:!min-w-0 [&>aside]:!border-0"><RelationshipPanel conversationId={conversationId} token={token} onArchived={onArchived}/></div>}
      {view==='memory'&&<MemoryPanel key={conversationId} conversationId={conversationId} token={token} defaultOpen onSourceNavigate={onClose}/>}
      {view==='proactive'&&<ProactivePreferences conversationId={conversationId}/>}
      {view==='usage'&&<>
        <p className="text-sm leading-6 text-muted-foreground">只显示本人可查看的身份、设定与记忆来源，不公开平台私有提示词。</p>
        {usageLoading?<p role="status">正在读取…</p>:usageError?<p role="alert" className="text-destructive">{usageError}</p>:!usage?<p className="text-sm text-muted-foreground">还没有普通聊天请求记录。</p>:<div className="space-y-3">
          <p className="text-xs text-muted-foreground">{new Date(usage.createdAt).toLocaleString('zh-CN')} 的请求</p>
          <ul className="divide-y divide-border">{usage.sources.sources.map((source,index)=><li key={source.kind+source.id+index} className="py-3 text-sm">{source.label}<span className="ml-2 text-xs text-muted-foreground">{source.kind==='worldbook'?'触发的背景条目':source.kind==='persona'?'用户身份':'回复设定'}</span></li>)}</ul>
          <p className="text-sm text-muted-foreground">确认记忆 {usage.sources.memoryFactIds?.length??0} 条。{usage.sources.truncated?'部分资料因预算未纳入。':''}</p>
        </div>}
      </>}
      {view==='settings'&&<>
        {error&&<div role="alert" className="text-sm text-destructive"><p>{error}</p><button type="button" className="min-h-11" onClick={reload}>重新读取</button></div>}
        {!data||!draft?!error&&<p role="status" className="text-sm">正在读取对话设置…</p>:<>
          <p className="text-sm leading-6 text-muted-foreground">仅影响本段对话的后续回复，不修改作者发布的角色和已有消息。</p>
          <label className="block space-y-2 text-sm"><span>本次对话中的我</span><select className={control} value={draft.personaId??''} onChange={event=>change({personaId:event.target.value||null})}><option value="">不绑定身份</option>{data.personas.map(persona=><option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></label>
          {([['responseStyle','回复风格',data.styles],['responseLength','回复长度倾向',data.lengths]] as const).map(([key,label,options])=>options.length>0&&<label key={key} className="block space-y-2 text-sm"><span>{label}</span><select className={control} value={draft[key]??''} onChange={event=>change({[key]:event.target.value||null})}><option value="">角色默认</option>{options.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}</select></label>)}
          <details className="rounded-2xl bg-secondary/40 px-4"><summary className="min-h-14 cursor-pointer py-4 text-sm">私人角色设定补充</summary><p className="mb-3 text-xs text-muted-foreground">补充称呼、语气或背景，只用于这段会话。</p><textarea aria-label="私人角色设定" rows={5} className={control+' mb-4'} maxLength={data.overrideMaxChars} value={draft.personalCharacterOverride} onChange={event=>change({personalCharacterOverride:event.target.value})}/></details>
          {data.worldbooks.length>0&&<details className="rounded-2xl bg-secondary/40 px-4"><summary className="min-h-14 cursor-pointer py-4 text-sm">附加世界书（已选 {draft.worldbookIds.length} 本）</summary><div className="pb-3">{data.worldbooks.map(book=><label key={book.id} className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={draft.worldbookIds.includes(book.id)} onChange={event=>change({worldbookIds:event.target.checked?[...draft.worldbookIds,book.id]:draft.worldbookIds.filter(id=>id!==book.id)})}/><span>{book.name}{!book.enabled?'（已停用）':''}</span></label>)}</div></details>}
          <button type="button" disabled={busy||!dirty} className="min-h-12 w-full rounded-full bg-brand px-4 text-sm font-medium text-brand-foreground disabled:opacity-40" onClick={async()=>{if(await save(draft))setDirty(false);}}>{busy?'正在保存…':dirty?'保存对话设置':'设置已保存'}</button>
          <nav aria-label="更多对话设置" className="divide-y divide-border">{([['relationship','对话关系'],['memory','角色记忆'],['personas','管理身份档案'],['worldbooks','管理世界书'],['usage','本轮参考了什么'],['proactive','主动问候']] as const).map(([key,label])=><button type="button" key={key} className="flex min-h-14 w-full items-center justify-between py-3 text-left text-[15px]" onClick={()=>setView(key)}>{label}<ChevronRight size={16} className="text-muted-foreground"/></button>)}</nav>
        </>}
      </>}
    </div>
  </ChatPanelSheet>;
}
