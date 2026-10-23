import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertReleaseCompatible} from './check-release.mjs';
import {loadWorkspaceEnvironment,projectRoot} from '../runtime/environment.mjs';
import {runApplications} from '../runtime/run-apps.mjs';

function sqlitePath(value){
  if(typeof value!=='string'||!value.startsWith('file:'))throw Error('DATABASE_URL必须指向SQLite文件。');
  const url=new URL(value,pathToFileURL(path.join(projectRoot,'database','schema.prisma')));
  if(url.protocol!=='file:')throw Error('DATABASE_URL必须指向SQLite文件。');
  return fileURLToPath(url);
}

/**
 * WAL 是数据库文件级设置：在这里设一次，之后每个新连接都直接是 WAL，
 * 不必让每个连接自己抢排他锁去切换。抢不到就退化成回滚日志，
 * 并发一上来查询就会超时（P1008）。
 */
function ensureWal(database){
  try{
    const client=new DatabaseSync(database);
    try{client.exec('PRAGMA journal_mode = WAL;');client.exec('PRAGMA busy_timeout = 8000;');}finally{client.close();}
    console.info(JSON.stringify({event:'sqlite_wal_ready'}));
  }catch(error){
    // 不阻断启动：应用内的 pragma 逻辑仍会尝试一次。
    console.error(JSON.stringify({event:'sqlite_wal_failed',message:error.message}));
  }
}

async function start(){
  loadWorkspaceEnvironment(false);
  const database=sqlitePath(process.env.DATABASE_URL);
  const migrations=await assertReleaseCompatible(database,projectRoot);
  console.info(JSON.stringify({event:'release_migrations_compatible',applied:migrations.appliedCount}));
  if(process.argv.includes('--check-only'))return;
  ensureWal(database);
  runApplications('start');
}

start().catch(error=>{console.error('Release startup blocked:',error.message);process.exitCode=1;});
