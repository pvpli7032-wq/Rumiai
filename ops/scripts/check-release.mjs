import {DatabaseSync} from 'node:sqlite';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {compareMigrationHistory} from '../../packages/backend/src/modules/operations/migration-status.mjs';

export async function assertReleaseCompatible(database,release=process.cwd()){
  if(!path.isAbsolute(database)||!path.isAbsolute(release))throw Error('数据库和发布目录必须使用绝对路径。');
  const entries=await readdir(path.join(release,'database','migrations'),{withFileTypes:true});
  const names=entries.filter(entry=>entry.isDirectory()).map(entry=>entry.name);
  if(!names.length)throw Error('发布目录没有迁移文件。');
  const db=new DatabaseSync(database,{readOnly:true});
  let records;
  try{records=db.prepare('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations').all();}finally{db.close();}
  const result=compareMigrationHistory(records,names);
  if(result.pendingCount!==0||result.unexpectedCount!==0||result.failedCount!==0){
    const error=new Error(`发布与数据库迁移不兼容：pending=${result.pendingCount}, unexpected=${result.unexpectedCount}, failed=${result.failedCount}`);
    error.report=result;throw error;
  }
  return result;
}

// Explicit paths keep this check independent of application .env loading.
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try {
    const [database,release=process.cwd(),...extra]=process.argv.slice(2);
    if(!database||extra.length)throw Error('用法：npm run release:check -- <数据库绝对路径> [发布目录绝对路径]');
    const result=await assertReleaseCompatible(database,release);
    console.log(JSON.stringify({compatible:true,...result}));
  }catch(error){
    if(error.report)console.log(JSON.stringify({compatible:false,...error.report}));
    else console.error(error.message);
    process.exitCode=1;
  }
}
