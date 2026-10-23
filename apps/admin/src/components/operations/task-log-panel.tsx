'use client';

import {useCallback, useEffect, useState} from 'react';
import {Play, RefreshCw} from 'lucide-react';
import {AdminNotice, AdminPanel} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {apiFetch} from '@admin/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {TASK_STATUS_LABELS, TASK_STATUS_VARIANTS, describeNextRun, formatDateTime, type TaskItem, type TaskListResponse, type TaskRunResult} from '../tasks/types';

/**
 * 系统运行页的任务块（V3 表 14：「数据库、任务、备份三块状态」＋「立即运行与查看日志」）。
 *
 * 数据全部来自已有能力，不新造日志系统：
 * - 状态与「日志」都是 background_tasks 里每个 kind 最新的一条记录（status / updatedAt /
 *   subjectId / lastError / nextRunAt），由 listAdminTasks() 读取；
 * - 立即运行调用 runAdminTaskOnce()，与后台任务页是同一个服务函数、同一套租约与重试。
 * 进程日志只写到 stdout，没有可读的日志文件，所以这里不伪造一个「系统日志」。
 */
export function TaskLogPanel({sessionActive}:{sessionActive: boolean}){
  const [items,setItems]=useState<TaskItem[]|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [running,setRunning]=useState('');
  const [openLog,setOpenLog]=useState('');

  const load=useCallback(async(signal?:AbortSignal)=>{
    try{const data=await apiFetch<TaskListResponse>(API.admin.tasks,{credentials: 'same-origin',cache:'no-store',signal});if(!signal?.aborted)setItems(data.items);}
    catch(cause){if(!signal?.aborted)setError(cause instanceof Error?cause.message:'任务状态读取失败。');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[sessionActive]);

  useEffect(()=>{const controller=new AbortController();setItems(null);setError('');setLoading(true);void load(controller.signal);return()=>controller.abort();},[load]);

  async function runOnce(item:TaskItem){
    if(running)return;
    setRunning(item.kind);setError('');setNotice('');
    try{
      const result=await apiFetch<TaskRunResult>(API.admin.taskRun(item.kind),{credentials: 'same-origin',method:'POST'});
      const failed=result.failed>0?`，${result.failed} 个失败`:'';
      setNotice(`${item.name}：${result.detail}（完成 ${result.affected} 个${failed}）`);
      setOpenLog(item.kind);
      await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'任务执行失败，请稍后重试。');}
    finally{setRunning('');}
  }

  return <AdminPanel
    title="后台任务"
    description="到期由轮询执行，也可以立刻跑一次。日志是每个任务最近一次的运行记录，来自 background_tasks。"
    badge={items?<Badge>{items.length} 个任务</Badge>:undefined}
    actions={<Button variant="outline" size="sm" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loading} onClick={()=>{setLoading(true);setError('');void load();}}>刷新</Button>}
  >
    {error&&<AdminNotice tone="error" title={error} className="mb-3" />}
    {notice&&<AdminNotice tone="success" title={notice} className="mb-3" />}
    {loading&&!items&&<AdminNotice tone="loading" title="正在读取任务状态…" />}
    {items&&items.length===0&&<p className="text-sm text-muted-foreground">没有登记的后台任务。</p>}
    {items&&items.length>0&&<div className="space-y-2">
      {items.map(item=>{
        const busy=running===item.kind;
        const open=openLog===item.kind;
        return <article key={item.kind} className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                {item.name}
                <Badge variant={TASK_STATUS_VARIANTS[item.lastStatus??'']??'neutral'}>{TASK_STATUS_LABELS[item.lastStatus??'']??'尚未运行'}</Badge>
                {!item.enabled&&<Badge variant="warning">开关已关</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">待处理 {item.pending} · 失败 {item.failed} · 最近运行 {formatDateTime(item.lastRunAt)} · 下次 {describeNextRun(item.nextRunAt)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={()=>setOpenLog(open?'':item.kind)} aria-expanded={open}>{open?'收起日志':'查看日志'}</Button>
              <Button variant="outline" size="sm" leadingIcon={<Play className="h-3.5 w-3.5" />} loading={busy} disabled={!!running||!item.runnable} onClick={()=>void runOnce(item)}>立即运行</Button>
            </div>
          </div>
          {open&&<dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">最近状态</dt><dd>{TASK_STATUS_LABELS[item.lastStatus??'']??'尚未运行'}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">最近时间</dt><dd>{formatDateTime(item.lastRunAt)}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">最近对象</dt><dd className="break-all">{item.lastSubjectId??'—'}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">失败原因</dt><dd className="break-words">{item.lastError??'无'}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">下次运行</dt><dd>{formatDateTime(item.nextRunAt)}</dd></div>
          </dl>}
        </article>;
      })}
    </div>}
    <p className="mt-3 text-xs text-muted-foreground">进程日志只写到标准输出，本页不读取也不伪造系统日志；这里能查的是每个任务在数据库里的最近一次运行记录。</p>
  </AdminPanel>;
}
