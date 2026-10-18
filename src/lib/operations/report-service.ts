import {compareMigrationHistory} from './migration-status.mjs';
export {compareMigrationHistory} from './migration-status.mjs';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {db,pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {readBackupInventory} from './backup-inventory';

export class OperationsReportError extends Error{
  constructor(message:string,status=400){super(message);this.name='OperationsReportError';this.status=status;}
  status:number;
}

export type OperationsAlert={code:'MIGRATION_FAILED'|'MIGRATION_PENDING'|'MIGRATION_DIRECTORY_UNAVAILABLE'|'MIGRATION_UNEXPECTED'|'BACKUP_UNAVAILABLE';severity:'error'|'warning';title:string;detail:string};

export function buildOperationsAlerts(
  migrations:{pendingCount:number|null;failedCount:number;unexpectedCount?:number|null},
  backups:{directoryPresent:boolean;singleFileBackups:number;stateBundles:number},
):OperationsAlert[]{
  const alerts:OperationsAlert[]=[];
  if(migrations.pendingCount===null)alerts.push({code:'MIGRATION_DIRECTORY_UNAVAILABLE',severity:'warning',title:'无法核对发布目录迁移',detail:'当前发布的迁移目录不可读，待应用数量未知。请检查发布文件是否完整。'});
  if((migrations.unexpectedCount??0)>0)alerts.push({code:'MIGRATION_UNEXPECTED',severity:'error',title:'数据库与发布目录迁移不一致',detail:`数据库中有 ${migrations.unexpectedCount} 条已应用迁移不在当前发布目录中。请核对应用版本和数据库归属，再安排发布或回滚。`});
  if(migrations.failedCount>0)alerts.push({code:'MIGRATION_FAILED',severity:'error',title:'数据库存在未完成迁移',detail:`检测到 ${migrations.failedCount} 条未完成迁移。先检查迁移日志和备份，再执行修复。`});
  if((migrations.pendingCount??0)>0)alerts.push({code:'MIGRATION_PENDING',severity:'warning',title:'当前发布目录有待应用迁移',detail:`检测到 ${migrations.pendingCount} 条待应用迁移。确认发布计划后再安排停机窗口。`});
  if(!backups.directoryPresent||backups.singleFileBackups+backups.stateBundles===0)alerts.push({code:'BACKUP_UNAVAILABLE',severity:'warning',title:'本机未发现备份文件',detail:'未发现数据库文件或带清单的状态目录；文件清单不代表完整性、恢复或异地备份验收已通过。'});
  return alerts;
}

export async function readOperationsReport(actorId:string){
  await pragmasReady;
  if(!await hasAdminPermission(actorId,'operations.read'))throw new OperationsReportError('当前账号没有运维状态查看权限。',403);
  const [database,migrations,backups]=await Promise.all([
    db.$queryRaw<Array<{connected:number}>>`SELECT 1 AS connected`,
    db.$queryRaw<Array<{migration_name:string;finished_at:number|null;rolled_back_at:number|null}>>`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
    `,
    readBackupInventory().catch(()=>{throw new OperationsReportError('备份目录暂不可读。',503);}),
  ]);
  let availableMigrations:string[]|null=null;
  try{availableMigrations=(await readdir(path.resolve(process.cwd(),'prisma','migrations'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name);}catch{}
  const migrationStatus=compareMigrationHistory(migrations,availableMigrations);
  const backupStatus={...backups};
  return {
    generatedAt:new Date().toISOString(),
    runtime:{installation:path.basename(process.cwd()),environment:process.env.NODE_ENV??'development',nodeVersion:process.version,uptimeSeconds:Math.floor(process.uptime())},
    database:{connected:Number(database[0]?.connected)===1,migrations:migrationStatus},
    backups,
    alerts:buildOperationsAlerts(migrationStatus,backupStatus),
    capabilities:{backupCreation:'命令行操作',restore:'仅支持恢复到新隔离目录',certificateRenewal:'由服务器外部运维流程执行',externalAlerts:'当前未配置'},
  };
}
