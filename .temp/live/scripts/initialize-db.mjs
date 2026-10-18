// Create SQLite's empty local file before migrate deploy (Prisma 5 Windows).
// Existing databases are never truncated, reset or replaced.
import nextEnv from '@next/env';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd());const url=process.env.DATABASE_URL;
if(url?.startsWith('file:')){const value=url.slice(5).split('?')[0];const file=path.resolve('prisma',value);fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file))fs.closeSync(fs.openSync(file,'wx'))}
const migrationEnv={...process.env};delete migrationEnv.RUST_LOG;
for(const args of [['node_modules/prisma/build/index.js','migrate','deploy'],['node_modules/prisma/build/index.js','generate'],['node_modules/tsx/dist/cli.mjs','prisma/seed.ts'],['node_modules/tsx/dist/cli.mjs','prisma/seed-site.ts']]){const result=spawnSync(process.execPath,args,{stdio:'inherit',env:migrationEnv});if(result.status!==0)process.exit(result.status||1)}

