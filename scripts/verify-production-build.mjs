import {randomBytes, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {rmSync, existsSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

const distDir = process.env.ISOLATED_BUILD_DIR?.trim() || '.next-validation-build';
if (existsSync(distDir)) throw new Error(`Refusing to overwrite existing build directory: ${distDir}`);
mkdirSync(distDir, {recursive: true});
const databaseName = `isolated-build-${process.pid}-${randomUUID()}.db`;
const databasePath = path.resolve('prisma', databaseName);
if (existsSync(databasePath)) throw new Error('Generated build database path unexpectedly already exists.');
writeFileSync(databasePath, '', {flag:'wx'});

const environment = {
  ...process.env,
  DATABASE_URL: `file:./${databaseName}`,
  JWT_SECRET: randomBytes(48).toString('hex'),
  NODE_ENV: 'production',
  NEXT_DIST_DIR: distDir,
  ISOLATED_BUILD_DIR: distDir,
  OPENAI_API_KEY: '',
  EZFP_ENABLED: 'false',
  EZFP_REFUNDS_ENABLED: 'false',
  ALLOW_SIMULATED_PURCHASES: 'false',
};
delete environment.RUST_LOG;

function run(command, args) {
  const result = spawnSync(command, args, {cwd: process.cwd(), env: environment, stdio: 'inherit', windowsHide: true});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

/**
 * 先把库切成 WAL 再构建。构建会同时开很多连接，谁先去切换 journal mode
 * 都要抢排他锁，抢不到就退回回滚日志，接着预渲染查询超时（P1008）。
 * WAL 是文件级设置，在这里设一次，后续连接就不必再抢。
 */
function enableWal() {
  const client = new DatabaseSync(databasePath);
  try {
    client.exec('PRAGMA journal_mode = WAL;');
    client.exec('PRAGMA busy_timeout = 8000;');
  } finally {
    client.close();
  }
}

try {
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  if (!process.exitCode) {
    enableWal();
    run(process.execPath, ['node_modules/next/dist/bin/next', 'build']);
  }
} finally {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(databasePath + suffix, {force: true});
  }
}
