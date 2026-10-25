'use client';
import {useEffect, useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {api} from '@web/lib/api-client';
import {ChatPanelSheet} from './chat-panel-sheet';
import {PersonaManager} from './persona-manager';
import {WorldbookManager} from './worldbook-manager';
import {RelationshipPanel} from './relationship-panel';
import {PlayModePicker} from '@web/components/stories/play-mode-picker';
import {MemoryPanel} from './memory-panel';
import {ReaderPreferences} from '@web/components/profile/reader-preferences';
import {ProactivePreferences} from '@web/components/profile/proactive-preferences';
import type {ConversationToolSettings} from '@rumiai/contracts/conversations/context-tools';
export type ConversationSettingsView = 'settings' | 'personas' | 'worldbooks' | 'usage' | 'proactive' | 'relationship' | 'memory' | 'reading' | 'reply' | 'identity' | 'play';
type Usage = {createdAt: string; sources: {sources: Array<{kind: string; id: string; label: string}>; truncated: boolean; memoryFactIds?: string[]}} | null;
export function ConversationContextPanel({open,onClose,conversationId,token,data,error,busy,reload,save,onArchived,currentMode='chat',initialView='settings'}: {
  currentMode?:'chat'|'scene'; initialView?:ConversationSettingsView;
  open:boolean;onClose:()=>void;conversationId:string;token:string;data:ConversationToolSettings|null;error:string;busy:boolean;reload:()=>void;save:(settings:ConversationToolSettings['settings'])=>Promise<boolean>;onArchived?:()=>void;
}) {
  const [view,setView]=useState<ConversationSettingsView>('settings'),[draft,setDraft]=useState<ConversationToolSettings['settings']|null>(null),[dirty,setDirty]=useState(false);
  const [usage,setUsage]=useState<Usage>(null),[usageError,setUsageError]=useState(''),[usageLoading,setUsageLoading]=useState(false);
  useEffect(()=>{if(open)setView(initialView);},[open,initialView]);
  useEffect(()=>{setView('settings');setDirty(false);setDraft(data?.settings??null);},[conversationId]);
  useEffect(()=>{if(data&&!dirty)setDraft(data.settings);},[data,dirty]);
  useEffect(()=>{
    if(!open||view!=='usage')return;const controller=new AbortController();const timeout=window.setTimeout(()=>controller.abort('timeout'),15000);setUsageLoading(true);setUsageError('');
    void api.get<Usage>('/api/conversations/'+conversationId+'/context/usage',{token,signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setUsage(value);}).catch(cause=>{if(controller.signal.reason==='timeout')setUsageError('读取超时，请返回后重试。');else if(!controller.signal.aborted)setUsageError(cause instanceof Error?cause.message:'读取失败。');}).finally(()=>{window.clearTimeout(timeout);if(!controller.signal.aborted||controller.signal.reason==='timeout')setUsageLoading(false);});
    return()=>{window.clearTimeout(timeout);controller.abort();};
  },[open,view,conversationId,token]);
  function change(value:Partial<ConversationToolSettings['settings']>){setDraft(current=>current?{...current,...value}:current);setDirty(true);}
  const title=view==='reply'?'回复方式':view==='identity'?'我的身份与背景':view==='play'?'玩法选择':view==='reading'?'阅读与输入':view==='relationship'?'对话关系':view==='memory'?'角色记忆':view==='settings'?'对话设置':view==='personas'?'身份档案':view==='worldbooks'?'世界书':view==='proactive'?'主动问候':'本轮参考了什么';
  const control='web-control min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-[15px] focus-visible:outline-2 focus-visible:outline-ring';
  return <ChatPanelSheet open={open} onClose={()=>{if(!dirty||window.confirm('设置尚未保存，确认关闭并保留当前编辑状态？'))onClose();}} title={title}>
    <div className="space-y-5 text-[15px] font-normal leading-6">
      {view!=='settings'&&<button type="button" className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground" onClick={()=>setView('settings')}><ChevronLeft size={16}/>返回对话设置</button>}
      {view==='personas'&&<PersonaManager token={token} onChanged={reload}/>}
      {view==='worldbooks'&&data&&<WorldbookManager token={token} characterId={data.characterId} canBindCharacter={data.canBindCharacterBooks} onChanged={reload}/>}
      {view==='relationship'&&<div className="[&>aside]:!block [&>aside]:!w-full [&>aside]:!min-w-0 [&>aside]:!border-0"><RelationshipPanel conversationId={conversationId} token={token} onArchived={onArchived}/></div>}
      {view==='memory'&&<MemoryPanel key={conversationId} conversationId={conversationId} token={token} defaultOpen onSourceNavigate={onClose}/>}
      {view==='reading'&&<ReaderPreferences/>}
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
          <p className="text-xs leading-5 text-muted-foreground">当前：{currentMode==='scene'?'角色场景':'角色对话'}。对话设定仅影响这段聊天。</p>
          <nav aria-label="更多对话设置" className="space-y-6">{([{title:'对话',items:[['play','玩法选择',currentMode==='scene'?'角色场景':'角色对话'],['reply','回复方式',[data.styles.find(x=>x.key===draft.responseStyle)?.label,data.lengths.find(x=>x.key===draft.responseLength)?.label].filter(Boolean).join(' · ')||'角色默认'],['relationship','对话关系','']]},{title:'记忆与背景',items:[['memory','角色记忆',data.memoryEnabled?'已开放':'暂未开放'],['identity','我的身份与私人设定',data.personas.find(x=>x.id===draft.personaId)?.name||'未绑定身份'],['worldbooks','管理世界书',draft.worldbookIds.length+' 本已选'],['personas','管理身份档案','']]},{title:'阅读与互动',items:[['reading','阅读、语音与发送习惯',''],['proactive','主动问候',''],['usage','本轮参考了什么','']]}] as const).map(group=><section key={group.title}><h3 className="mb-1 text-xs font-normal text-muted-foreground">{group.title}</h3><div className="divide-y divide-border">{group.items.map(([key,label,value])=><button type="button" key={key} aria-label={label} className="flex min-h-[52px] w-full items-center gap-3 py-3 text-left text-[15px] font-normal focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>setView(key)}><span className="min-w-0 flex-1">{label}</span>{value&&<span className="max-w-[42%] truncate text-right text-xs text-muted-foreground">{value}</span>}<ChevronRight size={16} className="shrink-0 text-muted-foreground"/></button>)}</div></section>)}</nav>
        </>}
      </>}
      {view==='play'&&data&&<><p className="text-sm leading-6 text-muted-foreground">切换玩法会打开独立对话，当前聊天记录会保留。</p><PlayModePicker characterId={data.characterId} token={token} currentMode={currentMode}/></>}
      {view==='reply'&&data&&draft&&<div className="space-y-5">
        <p className="text-sm leading-6 text-muted-foreground">选择适合这段聊天的表达方式，下次回复生效。</p>
        {data.styles.length===0&&data.lengths.length===0&&<p className="text-sm text-muted-foreground">当前沿用角色默认回复方式，平台尚未提供其他选项。</p>}
        {([['responseStyle','回复风格',data.styles],['responseLength','回复长度倾向',data.lengths]] as const).map(([key,label,options])=>options.length>0&&<label key={key} className="block space-y-2 text-[15px]"><span>{label}</span><select className={control} value={draft[key]??''} onChange={event=>change({[key]:event.target.value||null})}><option value="">角色默认</option>{options.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}</select></label>)}
      </div>}
      {view==='identity'&&data&&draft&&<div className="space-y-5">
        <label className="block space-y-2 text-[15px]"><span>本次对话中的我</span><select className={control} value={draft.personaId??''} onChange={event=>change({personaId:event.target.value||null})}><option value="">不绑定身份</option>{data.personas.map(persona=><option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></label>
        <label className="block space-y-2 text-[15px]"><span>私人角色设定补充</span><textarea aria-label="私人角色设定" rows={5} className={control} maxLength={data.overrideMaxChars} value={draft.personalCharacterOverride} onChange={event=>change({personalCharacterOverride:event.target.value})}/><span className="block text-xs leading-5 text-muted-foreground">补充称呼、语气或背景，不修改作者发布的角色。</span></label>
        {data.worldbooks.length>0&&<section><h3 className="mb-2 text-[15px] font-medium">附加世界书</h3><div className="divide-y divide-border">{data.worldbooks.map(book=><label key={book.id} className="flex min-h-[52px] items-center gap-3 text-[15px]"><input type="checkbox" checked={draft.worldbookIds.includes(book.id)} onChange={event=>change({worldbookIds:event.target.checked?[...draft.worldbookIds,book.id]:draft.worldbookIds.filter(id=>id!==book.id)})}/><span>{book.name}{!book.enabled?'（已停用）':''}</span></label>)}</div></section>}
      </div>}
      {draft&&(view==='reply'||view==='identity'||(view==='settings'&&dirty))&&<div className="sticky bottom-0 border-t border-border bg-background pb-[max(8px,env(safe-area-inset-bottom))] pt-3">{error&&<p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}<button type="button" disabled={busy||!dirty} className="min-h-[46px] w-full rounded-xl bg-brand px-4 text-[15px] font-normal text-brand-foreground disabled:opacity-40" onClick={async()=>{if(await save(draft))setDirty(false);}}>{busy?'正在保存…':dirty?'保存对话设置':'设置已保存'}</button></div>}
    </div>
  </ChatPanelSheet>;
}
