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
 *   node scripts/verify-ai-context.mjs
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';

const STUB_PORT = 4123;
const APP_PORT = 4124;
const TURNS = 25;
const HISTORY_TURNS = 20;

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
    console.error(`พอร์ต ${port} ถูกใช้อยู่ — ปิด process เดิมก่อนรัน`);
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
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'รับทราบ' } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
stub.listen(STUB_PORT);
await once(stub, 'listening');
console.log(`stub AI ที่พอร์ต ${STUB_PORT}`);

const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(APP_PORT)], {
  env: {
    ...process.env,
    // Its own build directory: sharing .next with a server already running in this
    // directory corrupts that server's route manifest.
    NEXT_DIST_DIR: 'artifacts/next-cache/verify-context',
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
  console.error('แอปไม่ขึ้น:\n' + appLog.slice(0, 800));
  process.exit(1);
}

const B = `http://127.0.0.1:${APP_PORT}`;
const auth = t => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'ผ่าน' : 'ไม่ผ่าน'} — ${label}`);
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
      body: JSON.stringify({ content: `ข้อความที่ ${i}` }),
    });
    await res.text(); // drain the stream so the turn completes
  }

  console.log(`\nส่งไป ${TURNS} ข้อความ, stub รับ ${captured.length} request`);
  const last = captured.at(-1);
  if (!last) {
    console.error('stub ไม่ได้รับ request — แอปอาจไม่ได้เรียก upstream');
    process.exit(1);
  }

  const userLines = last.messages.filter(m => m.role === 'user').map(m => m.content);

  console.log('\nตรวจ prompt ของ turn สุดท้าย:');
  check(
    userLines.filter(c => c === `ข้อความที่ ${TURNS}`).length === 1,
    `ข้อความล่าสุดปรากฏครั้งเดียว (ไม่ซ้ำ)`
  );
  check(
    userLines.at(-1) === `ข้อความที่ ${TURNS}`,
    'ข้อความล่าสุดอยู่ท้ายสุดของ prompt'
  );
  // The whole recent tail must be present. Checking only one turn back was too
  // weak: the buggy version happened to include messages 11-20, which excluded
  // message 1 and so passed a naive "not stuck at the start" assertion.
  const recentTail = Array.from({ length: 5 }, (_, i) => `ข้อความที่ ${TURNS - 1 - i}`);
  const missingTail = recentTail.filter(m => !userLines.includes(m));
  check(missingTail.length === 0, `จำ 5 turn ล่าสุดก่อนหน้าได้ครบ${missingTail.length ? ` (ขาด: ${missingTail.join(', ')})` : ''}`);

  // With HISTORY_TURNS of context nothing older than this may appear at all.
  const oldest = Math.max(1, TURNS - HISTORY_TURNS);
  const staleLines = userLines.filter(c => {
    const n = Number(/ข้อความที่ (\d+)/.exec(c)?.[1]);
    return Number.isFinite(n) && n < oldest;
  });
  check(staleLines.length === 0, `ไม่มีข้อความเก่ากว่า turn ${oldest} หลุดเข้ามา${staleLines.length ? ` (พบ: ${staleLines.join(', ')})` : ''}`);
  check(
    last.messages.length <= HISTORY_TURNS + 2,
    `ขนาด prompt ถูกจำกัด (${last.messages.length} <= ${HISTORY_TURNS + 2})`
  );
  check(last.messages[0].role === 'system', 'มี system prompt เป็นตัวแรก');

  console.log(
    failures === 0
      ? '\nprompt ที่ส่งเข้าโมเดลถูกต้อง'
      : `\nมี ${failures} ข้อไม่ผ่าน`
  );
} finally {
  killTree(app);
  stub.close();
}

process.exit(failures === 0 ? 0 : 1);
