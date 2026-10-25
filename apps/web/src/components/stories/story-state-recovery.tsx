'use client';
import {useRef,useState} from 'react';
export type StoryStateTurn={id:string;turnNo:number;status:string;stateStatus:string};
export function unfinishedStoryTurns(turns:StoryStateTurn[]){return turns.filter(turn=>turn.status==='COMMITTED'&&['PENDING','PROCESSING','FAILED'].includes(turn.stateStatus));}
export function StoryStateRecovery({run,token,disabled=false,onRefresh}:{run:{id:string;revision:number;turns:StoryStateTurn[]};token:string;disabled?:boolean;onRefresh:()=>Promise<void>}){
 const pending=unfinishedStoryTurns(run.turns),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),scope=useRef(run.id);scope.current=run.id;
 async function act(turn?:StoryStateTurn){if(lock.current||disabled)return;lock.current=true;const runId=run.id;setBusy(turn?.id??'refresh');setError('');setNotice('');try{
  if(turn){const response=await fetch('/api/story-runs/'+encodeURIComponent(runId)+'/turns/'+encodeURIComponent(turn.id)+'/retry-state',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:run.revision})});const body=await response.json();if(!response.ok){if(response.status===409)await onRefresh();throw Error(body.error||'重新提交整理失败，请重试。');}}
  await onRefresh();if(scope.current===runId)setNotice(turn?'已重新提交整理，请稍后刷新状态。':'已读取最新整理状态。');
 }catch(cause){if(scope.current===runId)setError(cause instanceof Error?cause.message:'状态读取失败，请重试。');}finally{lock.current=false;if(scope.current===runId)setBusy(null);}}
 return <section aria-label="故事整理状态" className="space-y-3 border-b border-border pb-4"><div className="flex items-center justify-between gap-3"><h3 className="text-[15px] font-medium">故事整理状态</h3><button type="button" disabled={Boolean(busy)||disabled} onClick={()=>void act()} className="min-h-11 shrink-0 px-2 text-sm text-primary disabled:opacity-40">{busy==='refresh'?'读取中…':'刷新整理状态'}</button></div>
 {pending.length?<><p className="text-[13px] leading-6 text-muted-foreground">正文已保存，仍有回合需要整理。完成前不能结束章节或存档；重试只处理已有正文。</p><ul className="divide-y divide-border">{pending.map(turn=><li key={turn.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="text-[15px]">第 {turn.turnNo} 回合</p><p className="mt-1 text-[13px] leading-5 text-muted-foreground">{turn.stateStatus==='FAILED'?'整理失败，可以重试。':turn.stateStatus==='PROCESSING'?'正在整理，请稍后刷新。':'等待后台整理；长时间未变化时可重新提交。'}</p></div>{turn.stateStatus!=='PROCESSING'&&<button type="button" aria-label={'重试整理 第'+turn.turnNo+'回合'} disabled={Boolean(busy)||disabled} onClick={()=>void act(turn)} className="min-h-11 shrink-0 rounded-full border border-border px-3 text-sm disabled:opacity-40">{busy===turn.id?'提交中…':'重试整理'}</button>}</li>)}</ul></>:<p className="text-[13px] leading-6 text-muted-foreground">{run.turns.some(turn=>turn.status==='COMMITTED')?'已保存回合的状态整理完成。':'还没有已提交的故事回合。'}</p>}
 {error&&<p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm leading-6 text-primary">{notice}</p>}
 </section>;
}
