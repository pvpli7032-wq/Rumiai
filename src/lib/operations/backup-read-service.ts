import {hasAdminPermission} from '@/lib/admin/authorization';
import {readBackupCatalog} from './backup-inventory';
import {resolveSqliteSource} from './sqlite-backup.mjs';

export class BackupCatalogError extends Error{
  constructor(message:string,readonly status=400){super(message);this.name='BackupCatalogError';}
}
export async function readManagedBackups(actor:string,page:number){
  if(!await hasAdminPermission(actor,'operations.read'))throw new BackupCatalogError('当前账号没有运维查看权限。',403);
  if(!Number.isSafeInteger(page)||page<1||page>10000)throw new BackupCatalogError('备份清单页码无效。');
  const activeDatabase=resolveSqliteSource(process.env.DATABASE_URL);
  return readBackupCatalog(page,{activeDatabase});
}
