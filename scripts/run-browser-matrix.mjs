/**
 * 第 8 章全链路浏览器矩阵的执行器。
 *
 * 仓库里有一批验收脚本（verify-browser / verify-security-browser / verify-m1-* /
 * verify-m2-browser / verify-m4-*-browser / verify-m5-*-browser / verify-m3-*）本身
 * 不起服务，它们要求调用方准备好一个「本机隔离实例」并通过 TEST_BASE_URL 指过去。
 * 之前缺这个入口，所以这些脚本一直没跑。
 *
 * 本脚本一次性完成：建隔离库 → 灌夹具 → 起 next start → 串行跑各子脚本 → 汇总 → 清理。
 *
 * 用法：
 *   node scripts/run-browser-matrix.mjs                       # 跑默认矩阵
 *   node scripts/run-browser-matrix.mjs test:browser test:m1:mobile
 *   node scripts/run-browser-matrix.mjs scripts/某个探针.mjs     # 跑任意脚本文件
 *   MATRIX_KEEP_ARTIFACTS=1 node scripts/run-browser-matrix.mjs test:browser
 *
 * 约束（刻意设计的）：
 * - 全程使用一次性 SQLite 文件 + 随机 JWT_SECRET，跑完归档到 artifacts/browser-matrix/<stamp>/，
 *   不会碰 prisma/dev.db，也不会连生产库。
 * - EZFP_ENABLED=false：矩阵跑在沙箱里，绝不触碰真实商户；真实支付链路由 C1 线上验收覆盖。
 * - 子脚本串行执行：它们共用同一个库和同一个实例，并行会互相看见彼此的数据。
 *
 * 运行模式：默认 `development`。这不是图省事，而是聊天链路的既有约定——
 * `mayUseMockChat()` 仅在 NODE_ENV !== 'production' 时放行模拟 AI，而 verify-m2-chat /
 * verify-browser 断言 SSE 里必须出现 `"demo":true` 与 `[DONE]`。离线跑矩阵拿不到第三方
 * 大模型密钥，所以只有这一条路能把「发消息 → 流式回包 → 落库」整条链路走通。
 * production 模式下的行为门禁独立由 `npm run test:production:guards` 覆盖，两者互补。
 */
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {mkdir, rm} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

const DEFAULT_MATRIX = [
  'test:browser',
  'test:security:browser',
  'test:screenshots',
  'test:m1:mobile',
  'test:m1:pwa',
  'test:m2:browser',
  'test:m4:ezfp:browser',
  'test:m4:finance:browser',
  'test:m5:closure:browser',
  'test:m5:export:browser',
  'test:story:browser',
  // 经济并发：签到/任务/打赏的「只能成功一次」不变量，必须打已经在跑的实例，
  // 所以它挂在矩阵里而不是自己起服务；所需任务夹具由 seedHttpFixtures 准备。
  'stress:economy',
];

const root = process.cwd();
const stamp = `${process.pid}-${Date.now()}`;
const databaseName = `browser-matrix-${stamp}.db`;
const databasePath = path.resolve('prisma', databaseName);
const out = path.resolve('artifacts/browser-matrix', stamp);
const scriptArtifacts = path.resolve(out, 'script-artifacts');

const requested = process.argv.slice(2).filter(argument => argument && !argument.startsWith('-'));
const matrix = requested.length ? requested : DEFAULT_MATRIX;
const keepArtifacts = process.env.MATRIX_KEEP_ARTIFACTS === '1';
const nodeEnv = process.env.MATRIX_NODE_ENV?.trim() || 'development';

const packageManifest = JSON.parse(require('node:fs').readFileSync(path.resolve('package.json'), 'utf8'));
const scripts = packageManifest.scripts ?? {};

async function unusedLocalPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法预留本机测试端口。');
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  return address.port;
}

function runNode(args, environment) {
  const result = spawnSync(process.execPath, args, {cwd: root, env: environment, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stdout || '') + (result.stderr || '') || `命令失败：${args.join(' ')}`);
  return result.stdout || '';
}

const environment = {
  ...process.env,
  DATABASE_URL: `file:./${databaseName}`,
  JWT_SECRET: randomBytes(48).toString('hex'),
  NODE_ENV: nodeEnv,
  OPENAI_API_KEY: '',
  EZFP_ENABLED: 'false',
  EZFP_REFUNDS_ENABLED: 'false',
  ALLOW_SIMULATED_PURCHASES: 'true',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_DIST_DIR: process.env.NEXT_DIST_DIR?.trim() || '.next-build',
  RUST_LOG: undefined,
};
delete environment.RUST_LOG;

const REVIEWER_EMAIL = 'reviewer@example.invalid';
const REVIEWER_PASSWORD = 'ReviewTest123!';

let prisma;
let server;
let serverOutput = '';
const summary = [];
try {
  if (!require('node:fs').existsSync(path.resolve(environment.NEXT_DIST_DIR, 'BUILD_ID'))) {
    throw new Error(`生产构建缺失（${environment.NEXT_DIST_DIR}/BUILD_ID 不存在），先跑 npm run build。`);
  }
  await mkdir(scriptArtifacts, {recursive: true});
  environment.UPLOADS_DIRECTORY = path.join(scriptArtifacts, 'uploads');

  // 1) 建库：沿用 make-local-db.mjs（沙箱里 Prisma schema engine 写不了文件，
  //    这个脚本用 node:sqlite 直接执行迁移 SQL 并补 _prisma_migrations 校验和）。
  console.log('[matrix] 建立隔离数据库…');
  runNode(['scripts/make-local-db.mjs', databasePath], environment);

  // 2) 基础内容：官方种子（角色 / 站点文案）。
  console.log('[matrix] 灌入官方种子…');
  for (const seed of ['prisma/seed.ts', 'prisma/seed-site.ts']) {
    runNode(['node_modules/tsx/dist/cli.mjs', seed], environment);
  }

  // 2.5) 故事模板：与生产同一条落库路径（scripts/publish-story-template.mjs），
  //      故事入口页与 /chat?storyRun 的浏览器验收都依赖已发布的模板。
  console.log('[matrix] 发布故事模板…');
  runNode(['node_modules/tsx/dist/cli.mjs', 'scripts/publish-story-template.mjs'], environment);

  // 3) 矩阵专用夹具。HTTP 主套件的任务与礼物必须由 `seedHttpFixtures` 显式准备：
  //    产品种子故意不激活任务（`Mission.isActive` 默认 false），CI 也是这么做的。
  console.log('[matrix] 灌入矩阵夹具…');
  process.env.DATABASE_URL = environment.DATABASE_URL;
  const {PrismaClient} = await import('@prisma/client');
  const {seedHttpFixtures} = await import('../tests/helpers/seed-http-fixtures.mjs');
  prisma = new PrismaClient();
  const packages = [
    {id: 'matrix-package-60', coins: 60, priceCnyCents: 600, bonus: 0, label: '尝鲜 · 60 金币', sortOrder: 1},
    {id: 'matrix-package-300', coins: 300, priceCnyCents: 2800, bonus: 30, label: '畅聊 · 300 金币', sortOrder: 2},
    {id: 'matrix-package-980', coins: 980, priceCnyCents: 8800, bonus: 120, label: '长期 · 980 金币', sortOrder: 3},
  ];
  for (const item of packages) {
    await prisma.coinPackage.create({data: {priceThb: 0, isActive: true, ...item}});
  }
  await seedHttpFixtures(prisma);
  const reviewer = await prisma.user.create({
    data: {username: 'reviewer', email: REVIEWER_EMAIL, passwordHash: await bcrypt.hash(REVIEWER_PASSWORD, 10)},
    select: {id: true},
  });
  environment.MODERATOR_USER_IDS = reviewer.id;
  environment.PAYMENT_ADMIN_USER_IDS = '';
  await prisma.$disconnect();
  prisma = undefined;

  // 4) 起生产实例。
  const port = await unusedLocalPort();
  const base = `http://127.0.0.1:${port}`;
  environment.PORT = String(port);
  environment.HOSTNAME = '127.0.0.1';
  environment.NEXT_PUBLIC_SITE_URL = base;
  console.log(`[matrix] 启动隔离实例 ${base} …`);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-12_000); };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  server.on('error', error => { serverOutput += `\n${error.message}`; });

  let ready = false;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`隔离实例提前退出。\n${serverOutput}`);
    try {
      const response = await fetch(`${base}/api/coins/packages`, {signal: AbortSignal.timeout(2000)});
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error(`隔离实例未就绪。\n${serverOutput}`);
  console.log(`[matrix] 实例就绪，开始串跑 ${matrix.length} 个脚本\n`);

  // 5) 串行执行。
  const childEnvironment = {
    ...environment,
    TEST_BASE_URL: base,
    TEST_ISOLATED_DB: 'true',
    TEST_DATABASE_URL: `file:./${databaseName}`,
    TEST_REVIEWER_EMAIL: REVIEWER_EMAIL,
    TEST_REVIEWER_PASSWORD: REVIEWER_PASSWORD,
    BROWSER_TEST_OUT: path.join(scriptArtifacts, 'browser-m0'),
    SHOTS_TEST_OUT: path.join(scriptArtifacts, 'page-shots'),
    M1_TEST_OUT: path.join(scriptArtifacts, 'm1-mobile'),
    M2_TEST_OUT: path.join(scriptArtifacts, 'm2-roles'),
  };
  for (const name of matrix) {
    // 名字可以是 package.json 里的脚本，也可以直接是 scripts/ 或 tests/ 下的文件（便于临时探针脚本）。
    const asFile = /\.(mjs|cjs|js|ts|tsx)$/.test(name);
    // 直接给文件路径时一律 `--import tsx`：这些脚本会顺着 import 链碰到 src 里的 TypeScript，
    // 而裸 node 解析不了 `@/` 别名（会报 Cannot find package '@/lib'），必须让 tsx 接管解析。
    // TypeScript 入口因此也能一起用，tests/runner.ts 这类套件挂在同一个隔离实例上跑得通。
    const command = asFile ? `node --import tsx ${name}` : scripts[name];
    if (!command) { summary.push({name, ok: false, passes: 0, skips: 0, detail: 'package.json 里没有这个脚本'}); console.log(`FAIL ${name}：package.json 里没有这个脚本`); continue; }
    const tokens = command.trim().split(/\s+/);
    assert.equal(tokens[0], 'node', `脚本 ${name} 不是 node 命令：${command}`);
    const args = [process.execPath, ...tokens.slice(1)];
    process.stdout.write(`──── ${name} ────\n`);
    const started = Date.now();
    const child = spawnSync(args[0], args.slice(1), {
      cwd: root, env: childEnvironment, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${child.stdout || ''}${child.stderr || ''}`;
    process.stdout.write(output);
    const passes = output.split('\n').filter(line => line.startsWith('PASS')).length;
    const skips = output.split('\n').filter(line => line.startsWith('SKIP')).length;
    const ok = child.status === 0 && !child.error;
    summary.push({name, ok, passes, skips, seconds: Math.round((Date.now() - started) / 1000), detail: child.error?.message ?? (ok ? '' : output.slice(-600))});
    process.stdout.write(`${ok ? 'OK  ' : 'FAIL'} ${name} · PASS=${passes} SKIP=${skips} · ${Math.round((Date.now() - started) / 1000)}s\n\n`);
  }

  // 6) 汇总。
  console.log('════ 矩阵汇总 ════');
  let totalPass = 0, totalSkip = 0, failed = 0;
  for (const item of summary) {
    totalPass += item.passes; totalSkip += item.skips;
    if (!item.ok) failed += 1;
    console.log(`${item.ok ? '✔' : '✘'} ${item.name.padEnd(28)} PASS=${String(item.passes).padStart(3)} SKIP=${String(item.skips).padStart(2)} ${item.seconds ? item.seconds + 's' : ''} ${item.ok ? '' : item.detail}`);
  }
  console.log(`── 合计 PASS=${totalPass} SKIP=${totalSkip} FAIL=${failed} / ${summary.length}`);
  if (failed) process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  if (prisma) await prisma.$disconnect().catch(() => {});
  if (keepArtifacts) {
    console.log(`[matrix] 保留产物：${out}`);
  } else {
    for (const suffix of ['', '-journal', '-wal', '-shm']) await rm(databasePath + suffix, {force: true});
  }
}
