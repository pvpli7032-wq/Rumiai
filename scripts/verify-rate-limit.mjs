/**
 * Verifies the chat rate limits against a stub AI endpoint.
 *
 * Measuring this against the real provider is misleading: a reply takes seconds, so
 * 35 sequential requests span more than the one-minute window and the burst limit
 * never trips — which is exactly why the daily cap exists as well. With a stub the
 * limits can be lowered and checked exactly, spending no AI quota.
 *
 *   node scripts/verify-rate-limit.mjs
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';

const STUB_PORT = 4133;
const APP_PORT = 4134;
const BURST_LIMIT = 5;
const DAILY_LIMIT = 8;

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

const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(APP_PORT)], {
  env: {
    ...process.env,
    // Its own build directory: sharing .next with a server already running in this
    // directory corrupts that server's route manifest.
    NEXT_DIST_DIR: 'artifacts/next-cache/verify-ratelimit',
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
  console.error('แอปไม่ขึ้น:\n' + appLog.slice(0, 600));
  killTree(app);
  stub.close();
  process.exit(1);
}

const B = `http://127.0.0.1:${APP_PORT}`;
const auth = t => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'ผ่าน' : 'ไม่ผ่าน'} — ${label}`);
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
  console.log(`\nขีดจำกัดที่ตั้งไว้: burst ${BURST_LIMIT}/2s, daily ${DAILY_LIMIT}`);

  console.log('\n1) ยิงรวดเดียวเกิน burst limit');
  const a = await newConversation('burst');
  const burstStatuses = [];
  for (let i = 0; i < BURST_LIMIT + 3; i++) burstStatuses.push(await send(a, `ข้อความ ${i}`));
  const allowed = burstStatuses.filter(s => s === 200).length;
  const blocked = burstStatuses.filter(s => s === 429).length;
  check(allowed === BURST_LIMIT, `อนุญาต ${allowed} ครั้ง (คาด ${BURST_LIMIT})`);
  check(blocked === 3, `ปฏิเสธด้วย 429 จำนวน ${blocked} ครั้ง (คาด 3)`);

  console.log('\n2) รอให้ window รีเซ็ตแล้วส่งได้อีก');
  await new Promise(r => setTimeout(r, 2500));
  check((await send(a, 'หลังรีเซ็ต')) === 200, 'ส่งได้หลัง window หมดอายุ');

  console.log('\n3) โควตารายวันครอบ burst window');
  // Already spent BURST_LIMIT + 1 of the daily budget on this account.
  let dailyHit = false;
  for (let i = 0; i < DAILY_LIMIT + 4; i++) {
    if ((await send(a, `วัน ${i}`)) === 429) {
      // Distinguish a daily block from a burst block by waiting out the window.
      await new Promise(r => setTimeout(r, 2500));
      if ((await send(a, 'ลองอีกครั้งหลังรีเซ็ต')) === 429) {
        dailyHit = true;
        break;
      }
    }
  }
  check(dailyHit, 'โควตารายวันปิดกั้นแม้ window นาทีรีเซ็ตแล้ว');

  console.log('\n4) ขีดจำกัดแยกตามบัญชี');
  const b = await newConversation('other');
  check((await send(b, 'บัญชีอื่น')) === 200, 'บัญชีอื่นไม่ถูกกระทบ');

  console.log('\n5) request ที่ไม่ถูกต้องไม่กินโควตา');
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
  check((await send(c, 'ข้อความจริง')) === 200, 'ข้อความว่างไม่นับเข้าโควตา');

  console.log(failures === 0 ? '\nrate limiting ทำงานถูกต้อง' : `\nมี ${failures} ข้อไม่ผ่าน`);
} finally {
  killTree(app);
  stub.close();
}

process.exit(failures === 0 ? 0 : 1);
