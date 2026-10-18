'use client';

import {useEffect,useState} from 'react';
import {MaintenanceSettings} from './maintenance-settings';
import {CertificateStatus} from './certificate-status';
import {BackupCatalog} from './backup-catalog';

type Report={generatedAt:string;runtime:{installation:string;environment:string;nodeVersion:string;uptimeSeconds:number};database:{connected:boolean;migrations:{appliedCount:number;availableCount:number|null;pendingCount:number|null;unexpectedCount:number|null;failedCount:number;lastMigration:string|null;lastAppliedAt:string|null}};backups:{directoryPresent:boolean;singleFileBackups:number;stateBundles:number;newestAt:string|null};alerts:Array<{code:string;severity:'error'|'warning';title:string;detail:string}>;capabilities:{backupCreation:string;restore:string;certificateRenewal:string;externalAlerts:string}};
const number=(value:number)=>new Intl.NumberFormat('zh-CN').format(value);
const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN'):'暂无记录';

export function OperationsOverview({token}:{token:string}){
  const [report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();void fetch('/api/admin/operations',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);return data as Report;}).then(setReport).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'运维状态读取失败。');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[token]);
  return <main className="mx-auto w-full max-w-[1440px] space-y-5">
    <header><h1 className="text-2xl font-bold md:text-3xl">系统与运维</h1><p className="mt-2 text-sm text-muted-foreground">运行状态、维护模式和备份清单；备份创建、恢复与证书续签由受控运维流程执行。</p></header>
    <MaintenanceSettings token={token}/>
    <CertificateStatus token={token}/>
    {loading&&<p role="status">正在检查服务与备份状态…</p>}{error&&<p role="alert" className="rounded-lg border border-red-500/30 p-4 text-red-400">{error}</p>}
    {report&&<>
      <section aria-labelledby="operations-alerts-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="operations-alerts-title" className="text-lg font-semibold">运维告警</h2><span className="text-xs text-muted-foreground">根据迁移名称核对和本机备份清单即时计算</span></div>
        {!report.alerts.length?<p role="status" className="rounded-xl border p-4 text-sm text-muted-foreground">当前未发现迁移失败、目录不一致、待应用迁移或缺失备份告警。</p>:<div className="grid gap-3 md:grid-cols-2">{report.alerts.map(alert=><article key={alert.code} role={alert.severity==='error'?'alert':'status'} className={`min-w-0 space-y-1 rounded-xl border p-4 ${alert.severity==='error'?'border-red-500/40':'border-amber-500/40'}`}><h3 className="font-medium">{alert.title}</h3><p className="break-words text-sm text-muted-foreground">{alert.detail}</p></article>)}</div>}
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-xl border bg-card p-4"><h2 className="font-semibold">应用进程</h2><p className="mt-2">状态：<strong className="text-emerald-500">正常</strong></p><p className="mt-1 break-words text-sm text-muted-foreground">运行单元 {report.runtime.installation}</p><p className="mt-1 text-sm text-muted-foreground">环境 {report.runtime.environment} · {report.runtime.nodeVersion} · 运行 {number(report.runtime.uptimeSeconds)} 秒</p></article>
        <article className="rounded-xl border bg-card p-4"><h2 className="font-semibold">数据库</h2><p className="mt-2">连接：<strong className={report.database.connected?'text-emerald-500':'text-red-500'}>{report.database.connected?'正常':'异常'}</strong></p><p className="mt-1 text-sm text-muted-foreground">已应用迁移 {number(report.database.migrations.appliedCount)}{report.database.migrations.availableCount===null?'':` / ${number(report.database.migrations.availableCount)}`} · 待应用 {report.database.migrations.pendingCount===null?'未知':number(report.database.migrations.pendingCount)} · 未完成 {number(report.database.migrations.failedCount)} · 目录外已应用 {report.database.migrations.unexpectedCount===null?'未知':number(report.database.migrations.unexpectedCount)}</p><p className="mt-1 break-all text-xs text-muted-foreground">最近迁移：{report.database.migrations.lastMigration??'暂无记录'} · {time(report.database.migrations.lastAppliedAt)}</p></article>
        <article className="rounded-xl border bg-card p-4"><h2 className="font-semibold">本机备份清单</h2><p className="mt-2">数据库文件 {number(report.backups.singleFileBackups)} 份 · 带清单状态目录 {number(report.backups.stateBundles)} 个</p><p className="mt-1 text-sm text-muted-foreground">目录 {report.backups.directoryPresent?'可用':'尚未创建'} · 最近修改 {time(report.backups.newestAt)}</p></article>
      </section>
      <section className="space-y-2 rounded-xl border p-4"><h2 className="font-semibold">运维动作边界</h2><p className="text-sm text-muted-foreground">备份创建：{report.capabilities.backupCreation}；恢复：{report.capabilities.restore}。本页不显示备份文件名、目录路径或密钥。</p><p className="text-sm text-muted-foreground">证书续签：{report.capabilities.certificateRenewal}；外部告警：{report.capabilities.externalAlerts}。</p><p className="text-xs text-muted-foreground">状态读取时间：{time(report.generatedAt)}。连接检查成功仅说明当前应用进程能访问数据库，不代表异地备份、证书续签或告警送达已通过。</p></section>
    </>}
    <BackupCatalog token={token}/>
  </main>;
}
