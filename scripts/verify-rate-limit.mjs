/**
 * 用 stub AI 端点校验聊天限流。
 *
 * 为什么不用真实供应商：一次真实回复要几秒，35 次串行请求早超过一分钟窗口，突发额度
 * 根本不会触发——这也正是还要有日额度的原因。换成 stub 后额度可以调低精确验证，
 * 且不消耗任何 AI 配额。
 *
 *   npm run test:rate:limit
 *
 * 隔离说明：限流额度必须在服务启动时通过环境变量注入，所以它不能复用矩阵的共享实例
 * （那台实例的额度是矩阵定的），这里自己起一个生产实例（`next start`，不是 dev —— 突发额度
 * 是进程内内存计数，dev 下多个 worker 各记各的，测出来的放行数字是假的）。
 * 数据库另行新建一个 `-<pid>-<毫秒时间戳>.db` 的一次性库并灌入官方角色种子，跑完自动回收；
 * 若不隔离，脚本会直接读写 `.env` 指向的库。
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createIsolatedDatabase } from './helpers/create-isolated-db.mjs';

const STUB_PORT = 4133;
const APP_PORT = 4134;
const BURST_LIMIT = 5;
const DAILY_LIMIT = 8;

const databaseName = `rate-limit-${process.pid}-${Date.now()}.db`;
const databasePath = path.resolve('prisma', databaseName);
createIsolatedDatabase(databasePath);
// 脚本要拿第一个已有角色建会话，所以必须灌官方角色种子，否则下面 chars[0] 会直接炸。
const seeded = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts'], {
  env: {...process.env, DATABASE_URL: `file:./${databaseName}`},
  encoding: 'utf8',
  windowsHide: true,
});
if (seeded.status !== 0) {
  console.error(`角色种子失败：\n${seeded.stdout || ''}${seeded.stderr || ''}`);
  process.exit(1);
}

async function portInUse(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
      .on('connect', () => (socket.destroy(), resolve(true)))
      .on('error', () => resolve(false));
    setTimeout(() => (socket.destroy(), resolve(false)), 1000);
  });
}
for (const port of [STUB_PORT, APP_PORT]) {
  if (await portInUse(port)) {
    console.error(`端口 ${port} 已被占用 —— 先关闭旧进程再运行。`);
    process.exit(2);
  }
}
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

const stub = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
stub.listen(STUB_PORT);
await once(stub, 'listening');

// 必须跑生产实例（`next start`），不能用 `next dev`：突发额度是进程内内存计数
// （见 src/lib/rate-limit.ts 的说明），dev 模式下 route 可能落在不同 worker 里，
// 每个 worker 各自计数，突发额度永远不会触发，测出来的结果是假的。
const distDir = process.env.NEXT_DIST_DIR?.trim() || '.next-build';
if (!existsSync(path.join(distDir, 'BUILD_ID'))) {
  console.error(`构建产物缺失或不完整：${distDir}/BUILD_ID 不存在，先执行 npm run build。`);
  process.exit(1);
}
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(APP_PORT)], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_DIST_DIR: distDir,
    DATABASE_URL: `file:./${databaseName}`,
    JWT_SECRET: randomBytes(48).toString('hex'),
    OPENAI_API_KEY: 'stub-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
    AI_FALLBACK_MODELS: '',
    AI_MODEL: 'stub-model',
    CHAT_RATE_LIMIT: String(BURST_LIMIT),
    CHAT_DAILY_LIMIT: String(DAILY_LIMIT),
    CHAT_RATE_WINDOW_MS: '2000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
for (const s of [app.stdout, app.stderr]) s.on('data', d => (appLog += d.toString()));
const deadline = Date.now() + 120_000;
while (!/Ready in|Error/.test(appLog) && Date.now() < deadline) await new Promise(r => setTimeout(r, 500));
if (!/Ready in/.test(appLog)) {
  console.error('应用未起来：\n' + appLog.slice(0, 600));
  killTree(app);
  stub.close();
  process.exit(1);
}

const B = `http://127.0.0.1:${APP_PORT}`;
const auth = t => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
let failures = 0;
// 与仓库其它验收脚本对齐：矩阵按行统计 `PASS`/`SKIP`，这里也用同一套前缀。
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

async function newConversation(tag) {
  const reg = await (
    await fetch(`${B}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `RL ${tag}`,
        email: `rl_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e9)}@example.com`,
        password: 'Password123!',
      }),
    })
  ).json();
  const chars = await (await fetch(`${B}/api/characters`, { headers: auth(reg.token) })).json();
  const conv = await (
    await fetch(`${B}/api/conversations`, {
      method: 'POST',
      headers: auth(reg.token),
      body: JSON.stringify({ characterId: chars[0].id }),
    })
  ).json();
  return { token: reg.token, convId: conv.conversation.id };
}

const send = async ({ token, convId }, text) => {
  const res = await fetch(`${B}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ content: text }),
  });
  await res.text();
  return res.status;
};

try {
  console.log(`\n设定的额度：突发 ${BURST_LIMIT}/2s，每日 ${DAILY_LIMIT}`);

  console.log('\n1) 连发超过突发额度');
  const a = await newConversation('burst');
  const burstStatuses = [];
  for (let i = 0; i < BURST_LIMIT + 3; i++) burstStatuses.push(await send(a, `第 ${i} 条消息`));
  const allowed = burstStatuses.filter(s => s === 200).length;
  const blocked = burstStatuses.filter(s => s === 429).length;
  check(allowed === BURST_LIMIT, `放行 ${allowed} 条（预期 ${BURST_LIMIT} 条）`);
  check(blocked === 3, `以 429 拒绝 ${blocked} 条（预期 3 条）`);

  console.log('\n2) 等窗口过期后可以再发');
  await new Promise(r => setTimeout(r, 2500));
  check((await send(a, '窗口重置后再发')) === 200, '突发窗口过期后恢复放行');

  console.log('\n3) 每日额度高于突发窗口');
  // 这个账号已经用掉 BURST_LIMIT + 1 条日额度。
  let dailyHit = false;
  for (let i = 0; i < DAILY_LIMIT + 4; i++) {
    if ((await send(a, `第 ${i} 天`)) === 429) {
      // 用「等窗口过期后重试」区分日额度拦截与突发拦截。
      await new Promise(r => setTimeout(r, 2500));
      if ((await send(a, '重置后再试一次')) === 429) {
        dailyHit = true;
        break;
      }
    }
  }
  check(dailyHit, '突发窗口重置后日额度仍然拦截');

  console.log('\n4) 额度按账号隔离');
  const b = await newConversation('other');
  check((await send(b, '另一个账号')) === 200, '另一个账号不受影响');

  console.log('\n5) 无效请求不占额度');
  const c = await newConversation('invalid');
  for (let i = 0; i < BURST_LIMIT + 5; i++) {
    const res = await fetch(`${B}/api/conversations/${c.convId}/messages`, {
      method: 'POST',
      headers: auth(c.token),
      body: JSON.stringify({ content: '' }),
    });
    await res.text();
    if (res.status === 429) break;
  }
  check((await send(c, '真实消息')) === 200, '空消息不计入额度');

  console.log(failures === 0 ? '\n限流行为正确。' : `\n有 ${failures} 项不通过。`);
} finally {
  killTree(app);
  stub.close();
}

process.exit(failures === 0 ? 0 : 1);
