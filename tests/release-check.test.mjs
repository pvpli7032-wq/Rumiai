import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('release check rejects older, pending, unfinished and unavailable histories without modifying the database',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'khui-release-')),file=path.join(root,'database.db');
  try{
    const migrations=path.join(root,'prisma','migrations');mkdirSync(migrations,{recursive:true});
    mkdirSync(path.join(migrations,'a'));mkdirSync(path.join(migrations,'b'));
    const db=new DatabaseSync(file);
    db.exec('CREATE TABLE _prisma_migrations(migration_name TEXT, finished_at INTEGER, rolled_back_at INTEGER); INSERT INTO _prisma_migrations VALUES(\'a\',1,NULL),(\'b\',2,NULL)');
    db.close();
    const run=(database=file)=>spawnSync(process.execPath,['--import','tsx','scripts/check-release.mjs',database,root],{encoding:'utf8',windowsHide:true});
    const before=readFileSync(file);
    assert.equal(run().status,0);
    rmSync(path.join(migrations,'b'),{recursive:true});mkdirSync(path.join(migrations,'c'));
    const older=run();assert.equal(older.status,1);const result=JSON.parse(older.stdout);assert.equal(result.unexpectedCount,1);assert.equal(result.pendingCount,1);
    mkdirSync(path.join(migrations,'b'));assert.equal(run().status,1);
    rmSync(path.join(migrations,'c'),{recursive:true});
    assert.deepEqual(readFileSync(file),before);
    const failed=new DatabaseSync(file);failed.exec("INSERT INTO _prisma_migrations VALUES('c',NULL,NULL)");failed.close();
    assert.equal(JSON.parse(run().stdout).failedCount,1);assert.equal(run().status,1);
    const missing=path.join(root,'missing.db');assert.equal(run(missing).status,1);assert.equal(existsSync(missing),false);
    rmSync(migrations,{recursive:true});assert.equal(run().status,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('production startup stops before launching Next when the selected release is older than its database',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'khui-start-gate-')),file=path.join(root,'database.db');
  try{
    const db=new DatabaseSync(file);db.exec('CREATE TABLE _prisma_migrations(migration_name TEXT, finished_at INTEGER, rolled_back_at INTEGER); INSERT INTO _prisma_migrations VALUES(\'unknown-release-migration\',1,NULL)');db.close();
    const databaseUrl=pathToFileURL(file).href;
    const result=spawnSync(process.execPath,['--import','tsx','scripts/start-production.mjs','--check-only'],{encoding:'utf8',windowsHide:true,env:{...process.env,DATABASE_URL:databaseUrl}});
    assert.equal(result.status,1);assert.match(result.stderr,/Release startup blocked: 发布与数据库迁移不兼容/);
    assert.match(result.stderr,/unexpected=1/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
