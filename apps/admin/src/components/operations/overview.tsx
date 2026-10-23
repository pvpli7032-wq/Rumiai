'use client';

import {useEffect,useState} from 'react';
import {MaintenanceSettings} from './maintenance-settings';
import {CertificateStatus} from './certificate-status';
import {BackupCatalog} from './backup-catalog';
import {TaskLogPanel} from './task-log-panel';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {formatNumber} from '@rumiai/contracts/format/number';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@rumiai/ui/tabs';

type Report={generatedAt:string;runtime:{installation:string;environment:string;nodeVersion:string;uptimeSeconds:number};database:{connected:boolean;engine:string;migrations:{appliedCount:number;availableCount:number|null;pendingCount:number|null;unexpectedCount:number|null;failedCount:number;lastMigration:string|null;lastAppliedAt:string|null}};backups:{directoryPresent:boolean;singleFileBackups:number;stateBundles:number;newestAt:string|null};alerts:Array<{code:string;severity:'error'|'warning';title:string;detail:string}>;capabilities:{backupCreation:string;restore:string;certificateRenewal:string;externalAlerts:string}};
const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN'):'暂无记录';

export function OperationsOverview({sessionActive}:{sessionActive: boolean}){
  const [report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();void fetch('/api/admin/operations',{credentials: 'include',cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);return data as Report;}).then(setReport).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'运维状态读取失败。');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[sessionActive]);
  return <AdminPage>
    <AdminPageHeader eyebrow="系统与安全" title="系统与运维" description="运行状态、维护模式和备份清单；备份创建、恢复与证书续签由受控运维流程执行。" />
    {loading&&<AdminNotice tone="loading" title="正在检查服务与备份状态…" />}
    {error&&<AdminNotice tone="error" title={error} />}
    <Tabs defaultValue="status">
      <TabsList aria-label="运维工作区">
        <TabsTrigger value="status">运行状态</TabsTrigger>
        <TabsTrigger value="maintenance">维护与证书</TabsTrigger>
        <TabsTrigger value="backup">备份与日志</TabsTrigger>
      </TabsList>
      <TabsContent value="status" keepMounted>
        {report&&<div className="space-y-5">
          <AdminPanel aria-label="运维告警" title="运维告警" description="根据迁移名称核对和本机备份清单即时计算。" badge={<Badge variant={report.alerts.length ? 'danger' : 'success'}>{report.alerts.length} 条</Badge>}>
            {!report.alerts.length ? <p className="text-sm text-muted-foreground">当前未发现迁移失败、目录不一致、待应用迁移或缺失备份告警。</p> : <div className="grid gap-3 md:grid-cols-2">{report.alerts.map(alert=><article key={alert.code} role={alert.severity==='error'?'alert':'status'} className={`min-w-0 space-y-1 rounded-2xl border p-4 shadow-sm ${alert.severity==='error'?'border-destructive/40 bg-destructive/5':'border-amber-500/40 bg-amber-500/5'}`}><h3 className="text-sm font-semibold text-foreground">{alert.title}</h3><p className="break-words text-sm text-muted-foreground">{alert.detail}</p></article>)}</div>}
          </AdminPanel>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm"><h2 className="text-sm font-semibold text-foreground">应用进程</h2><p className="mt-2 text-sm">状态：<strong className="text-emerald-600">正常</strong></p><p className="mt-1 break-words text-sm text-muted-foreground">运行单元 {report.runtime.installation}</p><p className="mt-1 text-sm text-muted-foreground">环境 {report.runtime.environment} · {report.runtime.nodeVersion} · 运行 {formatNumber(report.runtime.uptimeSeconds)} 秒</p></article>
            <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm"><h2 className="text-sm font-semibold text-foreground">数据库</h2><p className="mt-2 text-sm">类型：<strong className="text-foreground">{report.database.engine}</strong></p><p className="mt-1 text-sm">连接：<strong className={report.database.connected?'text-emerald-600':'text-destructive'}>{report.database.connected?'正常':'异常'}</strong></p><p className="mt-1 text-sm text-muted-foreground">已应用迁移 {formatNumber(report.database.migrations.appliedCount)}{report.database.migrations.availableCount===null?'':` / ${formatNumber(report.database.migrations.availableCount)}`} · 待应用 {report.database.migrations.pendingCount===null?'未知':formatNumber(report.database.migrations.pendingCount)} · 未完成 {formatNumber(report.database.migrations.failedCount)} · 目录外已应用 {report.database.migrations.unexpectedCount===null?'未知':formatNumber(report.database.migrations.unexpectedCount)}</p><p className="mt-1 break-all text-xs text-muted-foreground">最近迁移：{report.database.migrations.lastMigration??'暂无记录'} · {time(report.database.migrations.lastAppliedAt)}</p></article>
            <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm"><h2 className="text-sm font-semibold text-foreground">本机备份清单</h2><p className="mt-2 text-sm text-foreground">数据库文件 {formatNumber(report.backups.singleFileBackups)} 份 · 带清单状态目录 {formatNumber(report.backups.stateBundles)} 个</p><p className="mt-1 text-sm text-muted-foreground">目录 {report.backups.directoryPresent?'可用':'尚未创建'} · 最近修改 {time(report.backups.newestAt)}</p></article>
          </div>
          <AdminPanel title="运维动作边界" description="页面只展示状态，不含备份文件名、目录路径或密钥."><div className="space-y-2 text-sm"><p className="text-muted-foreground">备份创建：{report.capabilities.backupCreation}；恢复：{report.capabilities.restore}。</p><p className="text-muted-foreground">证书续签：{report.capabilities.certificateRenewal}；外部告警：{report.capabilities.externalAlerts}。</p><p className="text-xs text-muted-foreground">状态读取时间：{time(report.generatedAt)}。连接检查成功仅说明当前应用进程能访问数据库，不代表异地备份、证书续签或告警送达已通过。</p></div></AdminPanel>
        </div>}
      </TabsContent>
      <TabsContent value="maintenance" keepMounted><div className="space-y-5"><MaintenanceSettings sessionActive={sessionActive}/><CertificateStatus sessionActive={sessionActive}/></div></TabsContent>
      <TabsContent value="backup" keepMounted><div className="space-y-5"><BackupCatalog sessionActive={sessionActive}/><TaskLogPanel sessionActive={sessionActive}/></div></TabsContent>
    </Tabs>
  </AdminPage>;
}
