import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkspaceEnvironment } from '../../ops/runtime/environment.mjs';

test('workspace env reloads after Next processed env while preserving explicit values and root markers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rumiai-env-'));
  const saved = { processed: process.env.__NEXT_PROCESSED_ENV, database: process.env.DATABASE_URL, projectRoot: process.env.RUMIAI_PROJECT_ROOT, root: process.env.RUMIAI_ROOT };
  try {
    writeFileSync(join(dir, '.env.local'), 'DATABASE_URL=file:./from-workspace.sqlite\nRUMIAI_TEST_ENV=loaded\n', 'utf8');
    process.env.__NEXT_PROCESSED_ENV = 'true';
    delete process.env.DATABASE_URL;
    process.env.RUMIAI_ROOT = 'preserve-me';
    loadWorkspaceEnvironment(true, dir);
    assert.equal(process.env.RUMIAI_TEST_ENV, 'loaded');
    assert.equal(process.env.DATABASE_URL, `file:${join(dir, 'database', 'from-workspace.sqlite').replaceAll('\\', '/')}`);
    assert.equal(process.env.RUMIAI_PROJECT_ROOT, dir);
    assert.equal(process.env.RUMIAI_ROOT, 'preserve-me');

    process.env.DATABASE_URL = 'file:./explicit.sqlite';
    loadWorkspaceEnvironment(true, dir);
    assert.equal(process.env.DATABASE_URL, `file:${join(dir, 'database', 'explicit.sqlite').replaceAll('\\', '/')}`);
    assert.equal(process.env.RUMIAI_ROOT, 'preserve-me');
  } finally {
    if (saved.processed === undefined) delete process.env.__NEXT_PROCESSED_ENV; else process.env.__NEXT_PROCESSED_ENV = saved.processed;
    if (saved.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.database;
    if (saved.projectRoot === undefined) delete process.env.RUMIAI_PROJECT_ROOT; else process.env.RUMIAI_PROJECT_ROOT = saved.projectRoot;
    if (saved.root === undefined) delete process.env.RUMIAI_ROOT; else process.env.RUMIAI_ROOT = saved.root;
    delete process.env.RUMIAI_TEST_ENV;
    rmSync(dir, { recursive: true, force: true });
  }
});
