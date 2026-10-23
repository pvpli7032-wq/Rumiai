import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {PrismaClient} from '@prisma/client';
import {pathToFileURL} from 'node:url';
import {resolveSqliteSource} from '../../packages/backend/src/modules/operations/sqlite-backup.mjs';
import {uploadDirectory} from '../../packages/backend/src/modules/uploads/storage-location.mjs';
import {backupDirectory} from '../../packages/backend/src/modules/operations/backup-directory.mjs';
import {resolveWorkspaceDatabaseUrl} from '../../ops/runtime/environment.mjs';

test('SQLite relative paths remain relative to database schema, not an app cwd', () => {
  const root=path.join(os.tmpdir(),'rumiai-runtime-path-test');
  assert.equal(resolveSqliteSource('file:./dev.db',root),path.join(root,'database','dev.db'));
});

test('absolute SQLite URIs preserve encoded spaces and do not acquire a database prefix', () => {
  const file=path.join(os.tmpdir(),'rumiai runtime path','isolated.db');
  assert.equal(resolveSqliteSource(pathToFileURL(file).href),file);
});

test('normalized workspace URL opens the same SQLite file through the real Prisma runtime',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'rumiai Prisma path '));
  const filename=path.join(directory,'probe.sqlite');
  const fixture=new DatabaseSync(filename);
  fixture.exec('CREATE TABLE runtime_probe (value INTEGER); INSERT INTO runtime_probe VALUES (7);');
  fixture.close();
  const prisma=new PrismaClient({datasources:{db:{url:resolveWorkspaceDatabaseUrl(pathToFileURL(filename).href)}}});
  try {
    assert.deepEqual(await prisma.$queryRawUnsafe('SELECT value FROM runtime_probe'),[{value:7}]);
  }finally{await prisma.$disconnect();rmSync(directory,{recursive:true,force:true});}
});

test('uploads and backups have the same root in each independent application', () => {
  const previous={root:process.env.RUMIAI_PROJECT_ROOT,uploads:process.env.UPLOADS_DIRECTORY,backups:process.env.BACKUPS_DIRECTORY};
  const root=path.join(os.tmpdir(),'rumiai-runtime-path-test');
  try {
    process.env.RUMIAI_PROJECT_ROOT=root;
    delete process.env.UPLOADS_DIRECTORY;
    delete process.env.BACKUPS_DIRECTORY;
    assert.equal(uploadDirectory(),path.join(root,'apps/web/public/uploads'));
    assert.equal(backupDirectory(),path.join(root,'database/backups'));
    process.env.UPLOADS_DIRECTORY='shared/uploads';
    process.env.BACKUPS_DIRECTORY='shared/backups';
    assert.equal(uploadDirectory(),path.join(root,'shared/uploads'));
    assert.equal(backupDirectory(),path.join(root,'shared/backups'));
  } finally {
    for(const [key,value] of [['RUMIAI_PROJECT_ROOT',previous.root],['UPLOADS_DIRECTORY',previous.uploads],['BACKUPS_DIRECTORY',previous.backups]]) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
