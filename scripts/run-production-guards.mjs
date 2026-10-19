import {randomBytes, randomUUID} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, rmSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const root = process.cwd();
const databaseName = `production-guards-${process.pid}-${randomUUID()}.db`;
const databasePath = path.resolve('prisma', databaseName);
const environment = {
  ...process.env,
  DATABASE_URL: `file:./${databaseName}`,
  JWT_SECRET: randomBytes(48).toString('hex'),
  NODE_ENV: 'production',
  npm_lifecycle_event: 'start',
  OPENAI_API_KEY: '',
  EZFP_ENABLED: 'false',
  EZFP_REFUNDS_ENABLED: 'false',
  ALLOW_SIMULATED_PURCHASES: 'true',
  NEXT_TELEMETRY_DISABLED: '1',
};
environment.NEXT_DIST_DIR = process.env.NEXT_DIST_DIR?.trim() || '.next-build';
delete environment.RUST_LOG;

async function unusedLocalPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local test port.');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

let prisma;
let server;
let serverOutput = '';
try {
  if (!existsSync(path.resolve(environment.NEXT_DIST_DIR, 'BUILD_ID'))) {
    throw new Error('Production build is missing; run npm run build before production guards.');
  }
  if (existsSync(databasePath)) throw new Error('Generated guard database path unexpectedly already exists.');
  createIsolatedDatabase(databasePath);

  process.env.DATABASE_URL = environment.DATABASE_URL;
  const {PrismaClient} = await import('@prisma/client');
  prisma = new PrismaClient();
  const creator = await prisma.user.create({
    data: {username: `guard_creator_${process.pid}`, email: `guard_creator_${process.pid}@example.invalid`, passwordHash: 'synthetic-production-guard-only'},
    select: {id: true},
  });
  await prisma.character.create({
    data: {creatorId: creator.id, name: 'Production guard character', personality: 'Synthetic fixture', background: '', isPublic: true, reviewStatus: 'APPROVED'},
  });
  await prisma.coinPackage.create({
    data: {id: 'production-guard-package', coins: 60, priceThb: 0, priceCnyCents: 600, bonus: 0, label: 'Production guard fixture', sortOrder: 0, isActive: true},
  });
  await prisma.$disconnect();
  prisma = undefined;

  const port = await unusedLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  environment.PORT = String(port);
  environment.HOSTNAME = '127.0.0.1';
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-12_000); };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  server.on('error', error => { serverOutput += `\n${error.message}`; });

  let ready = false;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Production server exited before becoming ready.\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/coins/packages`, {signal: AbortSignal.timeout(1500)});
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error(`Production server did not become ready.\n${serverOutput}`);

  const verification = spawnSync(process.execPath, ['scripts/verify-production-guards.mjs'], {
    cwd: root, env: {...environment, TEST_BASE_URL: baseUrl}, encoding: 'utf8', windowsHide: true,
  });
  if (verification.error) throw verification.error;
  if (verification.status !== 0) throw new Error((verification.stdout || '') + (verification.stderr || '') || `Production guard checks exited ${verification.status}.`);
  process.stdout.write(verification.stdout);
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  if (prisma) await prisma.$disconnect().catch(() => {});
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(databasePath + suffix, {force: true});
}
