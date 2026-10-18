import {spawn} from 'node:child_process';
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

async function start(){
  loadEnvConfig(process.cwd());
  const database=sqlitePath(process.env.DATABASE_URL);
  const migrations=await assertReleaseCompatible(database,process.cwd());
  console.info(JSON.stringify({event:'release_migrations_compatible',applied:migrations.appliedCount}));
  if(process.argv.includes('--check-only'))return;
  const child=spawn(process.execPath,[path.join(process.cwd(),'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3000'],{cwd:process.cwd(),env:process.env,stdio:'inherit',windowsHide:true});
  let stopping=false;
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(!stopping){stopping=true;child.kill(signal);}});
  child.once('error',error=>{console.error('Unable to start Next.js:',error.message);process.exitCode=1;});
  child.once('exit',(code,signal)=>{process.exitCode=signal?1:(code??1);});
}

start().catch(error=>{console.error('Release startup blocked:',error.message);process.exitCode=1;});
