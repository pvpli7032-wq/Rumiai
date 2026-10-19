/**
 * Verifies what the chat route actually sends to the model.
 *
 * The E2E suite is opaque-box and cannot see the upstream prompt, which is how two
 * context bugs went unnoticed: history was fetched ascending with `take`, so past 20
 * messages a character only ever saw how the conversation opened, and the newly saved
 * user message was both included in history and appended again, so it arrived twice.
 *
 * This stands up a fake OpenAI-compatible endpoint, points the app at it, holds a
 * long conversation, and asserts on the recorded prompts. No real AI quota is spent.
 *
 *   npm run test:ai:context
 *
 * 隔离说明：脚本要新建一个 `-<pid>-<毫秒时间戳>.db` 的一次性库并灌入官方角色种子，
 * 跑完自动回收；不隔离的话它会直接读写 `.env` 指向的库，把探针数据写进正式库。
 * 同时必须跑 `next start` 而不是 `next dev`：dev 的 route 可能落在不同 worker，
 * 而突发额度、内存态等实现是按单进程设计的，dev 下测出来的结果不可信。
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createIsolatedDatabase } from './helpers/create-isolated-db.mjs';

const STUB_PORT = 4123;
const APP_PORT = 4124;
const TURNS = 25;
const HISTORY_TURNS = 20;

const databaseName = `ai-context-${process.pid}-${Date.now()}.db`;
createIsolatedDatabase(path.resolve('prisma', databaseName));
// 探针要用现有角色建会话，没有种子下面 chars[0] 会直接炸。
const seeded = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts'], {
  env: {...process.env, DATABASE_URL: `file:./${databaseName}`},
  encoding: 'utf8',
  windowsHide: true,
});
if (seeded.status !== 0) {
  console.error(`角色种子失败：\n${seeded.stdout || ''}${seeded.stderr || ''}`);
  process.exit(1);
}

/** Refuse to run against a stale process — that would look like a test result. */
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

/** `app.kill()` only kills the shell on Windows, orphaning next and its port. */
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

const captured = [];

const stub = createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    try {
      captured.push(JSON.parse(body));
    } catch {
      captured.push(null);
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '收到' } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
stub.listen(STUB_PORT);
await once(stub, 'listening');
console.log(`stub AI 监听 ${STUB_PORT} 端口`);

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
    AI_HISTORY_TURNS: String(HISTORY_TURNS),
    CHAT_RATE_LIMIT: '500',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let appLog = '';
for (const s of [app.stdout, app.stderr]) s.on('data', d => (appLog += d.toString()));

const deadline = Date.now() + 120_000;
while (!/Ready in|Error/.test(appLog) && Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 500));
}
if (!/Ready in/.test(appLog)) {
  console.error('应用未起来：\n' + appLog.slice(0, 800));
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

try {
  const reg = await (
    await fetch(`${B}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Context Probe',
        email: `ctx_${Date.now()}@example.com`,
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
  const convId = conv.conversation.id;

  for (let i = 1; i <= TURNS; i++) {
    const res = await fetch(`${B}/api/conversations/${convId}/messages`, {
      method: 'POST',
      headers: auth(reg.token),
      body: JSON.stringify({ content: `第 ${i} 条消息` }),
    });
    await res.text(); // 把流读完，这一轮才算结束
  }

  console.log(`\n已发出 ${TURNS} 条消息，stub 收到 ${captured.length} 个请求`);
  const last = captured.at(-1);
  if (!last) {
    console.error('stub 没收到请求 —— 应用可能没有调用上游。');
    process.exit(1);
  }

  const userLines = last.messages.filter(m => m.role === 'user').map(m => m.content);

  console.log('\n检查最后一轮的 prompt：');
  check(
    userLines.filter(c => c === `第 ${TURNS} 条消息`).length === 1,
    '最新一条消息只出现一次（没有重复）'
  );
  check(
    userLines.at(-1) === `第 ${TURNS} 条消息`,
    '最新一条消息位于 prompt 末尾'
  );
  // The whole recent tail must be present. Checking only one turn back was too
  // weak: the buggy version happened to include messages 11-20, which excluded
  // message 1 and so passed a naive "not stuck at the start" assertion.
  const recentTail = Array.from({ length: 5 }, (_, i) => `第 ${TURNS - 1 - i} 条消息`);
  const missingTail = recentTail.filter(m => !userLines.includes(m));
  check(missingTail.length === 0, `最近 5 轮历史齐全${missingTail.length ? `（缺：${missingTail.join('、')}）` : ''}`);

  // With HISTORY_TURNS of context nothing older than this may appear at all.
  const oldest = Math.max(1, TURNS - HISTORY_TURNS);
  const staleLines = userLines.filter(c => {
    const n = Number(/第 (\d+) 条消息/.exec(c)?.[1]);
    return Number.isFinite(n) && n < oldest;
  });
  check(staleLines.length === 0, `没有早于第 ${oldest} 轮的旧消息混入${staleLines.length ? `（发现：${staleLines.join('、')}）` : ''}`);
  check(
    last.messages.length <= HISTORY_TURNS + 2,
    `prompt 长度受限（${last.messages.length} <= ${HISTORY_TURNS + 2}）`
  );
  check(last.messages[0].role === 'system', '第一条是 system prompt');

  console.log(failures === 0 ? '\n送入模型的 prompt 正确。' : `\n有 ${failures} 项不通过。`);
} finally {
  killTree(app);
  stub.close();
}

process.exit(failures === 0 ? 0 : 1);
