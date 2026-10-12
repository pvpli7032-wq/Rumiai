import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const file = `auth-config-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
const migrationEnv = { ...process.env }; delete migrationEnv.RUST_LOG;
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: migrationEnv, encoding: 'utf8' });
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
const { db, pragmasReady } = await import('../src/lib/db.ts'); await pragmasReady;
const { ensureAuthSigningConfiguration, signToken } = await import('../src/lib/auth.ts');
const { POST: register } = await import('../src/app/api/auth/register/route.ts');
test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), { force: true }); });

test('production refuses published/blank/short signing secrets before signup writes', async () => {
  const originalMode = process.env.NODE_ENV, originalSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  try {
    for (const secret of ['', ' '.repeat(40), 'short', 'khuiai-secret-jwt-key-2026', 'replace-with-a-random-secret-at-least-32-characters', 'ci-only-secret-not-used-anywhere-else-000000']) {
      process.env.JWT_SECRET = secret;
      assert.throws(ensureAuthSigningConfiguration);
      const response = await register(new Request('http://localhost/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'authcfg_test', email: 'authcfg@example.invalid', password: 'LocalOnly!12345' }) }));
      assert.equal(response.status, 503);
      assert.equal(await db.user.count(), 0);
    }
    process.env.JWT_SECRET = randomUUID() + randomUUID();
    assert.doesNotThrow(ensureAuthSigningConfiguration);
    assert.equal(typeof await signToken({ userId: 'synthetic', email: 'synthetic@example.invalid' }), 'string');
  } finally {
    if (originalMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalMode;
    if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
  }
});
