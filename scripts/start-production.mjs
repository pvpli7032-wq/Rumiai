import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import nextEnv from '@next/env';
import {assertReleaseCompatible} from './check-release.mjs';
const {loadEnvConfig}=nextEnv;

function sqlitePath(value){
  if(typeof value!=='string'||!value.startsWith('file:'))throw Error('DATABASE_URL必须指向SQLite文件。');
  const url=new URL(value,pathToFileURL(path.resolve('prisma','schema.prisma')));
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
  loadEnvConfig(process.cwd());
  const database=sqlitePath(process.env.DATABASE_URL);
  const migrations=await assertReleaseCompatible(database,process.cwd());
  console.info(JSON.stringify({event:'release_migrations_compatible',applied:migrations.appliedCount}));
  if(process.argv.includes('--check-only'))return;
  ensureWal(database);
  // next.config 只有在 `npm start`/`npm run build` 下才凭 npm_lifecycle_event 选到 .next-build。
  // 被 PM2 或 systemd 直接 exec 时没有那个变量，会退回 .next 并报「找不到生产构建」，
  // 所以这里兜住缺省值，部署方不必再记得单独注入这个环境变量。
  if (!process.env.NEXT_DIST_DIR?.trim()) process.env.NEXT_DIST_DIR = '.next-build';
  const child=spawn(process.execPath,[path.join(process.cwd(),'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3000'],{cwd:process.cwd(),env:process.env,stdio:'inherit',windowsHide:true});
  let stopping=false;
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(!stopping){stopping=true;child.kill(signal);}});
  child.once('error',error=>{console.error('Unable to start Next.js:',error.message);process.exitCode=1;});
  child.once('exit',(code,signal)=>{process.exitCode=signal?1:(code??1);});
}

start().catch(error=>{console.error('Release startup blocked:',error.message);process.exitCode=1;});
