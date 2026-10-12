/**
 * Concurrency stress for the coin economy. The Tier 2 suite covers these cases
 * once each; this hammers them repeatedly, which is how the check-in and mission
 * double-award races were caught (a single pass had looked clean).
 *
 *   TEST_BASE_URL=http://localhost:3000 node scripts/stress-economy.mjs
 */
const B = process.env.TEST_BASE_URL || 'http://localhost:3000';
const auth = t => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

async function reg(tag) {
  const r = await fetch(`${B}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Stress ${tag}`,
      email: `stress_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e9)}@example.com`,
      password: 'Password123!',
    }),
  });
  return readJson(r, 'POST /api/auth/register');
}
/**
 * Read a JSON body, failing with the status and a snippet instead of letting
 * JSON.parse throw on an HTML error page. A locale redirect on an API path once made
 * this return the rendered 404, and the crash gave no clue which call was at fault.
 */
async function readJson(res, label) {
  const body = await res.text();
  if (!res.ok) throw new Error(`${label} -> HTTP ${res.status}: ${body.slice(0, 160)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} -> ${res.status} but body is not JSON (${res.headers.get('content-type')}): ${body.slice(0, 160)}`);
  }
}

const coins = async t =>
  (await readJson(await fetch(`${B}/api/users/me`, { headers: auth(t), redirect: 'manual' }), 'GET /api/users/me')).coins;

const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY) || 8;
const ROUNDS = Number(process.env.STRESS_ROUNDS) || 10;
let checkinBad = 0;
let missionBad = 0;
let giftBad = 0;
let legacyGiftBad = 0;
let malformedGiftBad = 0;

const publicCharacters = await readJson(
  await fetch(`${B}/api/characters?sort=new`, { redirect: 'manual' }),
  'GET /api/characters?sort=new'
);
if (!Array.isArray(publicCharacters) || publicCharacters.length === 0) {
  throw new Error('Economy stress test requires at least one approved public character in its isolated database');
}
const publicCharacterId = publicCharacters[0].id;

for (let i = 0; i < ROUNDS; i++) {
  // --- check-in race: exactly one +10 expected ---
  const u = await reg(`ci${i}`);
  const before = await coins(u.token);
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => fetch(`${B}/api/checkin`, { method: 'POST', headers: auth(u.token) }))
  );
  const after = await coins(u.token);
  if (after - before !== 10) {
    checkinBad++;
    console.log(`  [checkin รอบ ${i}] ได้ +${after - before} แทน +10`);
  }

  // --- mission race: exactly one reward expected ---
  const m = await reg(`ms${i}`);
  const missions = await (await fetch(`${B}/api/missions`, { headers: auth(m.token) })).json();
  const list = Array.isArray(missions) ? missions : missions.missions || [];
  if (list.length) {
    const mission = list[0];
    const mBefore = await coins(m.token);
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        fetch(`${B}/api/missions/${mission.id}/complete`, { method: 'POST', headers: auth(m.token) })
      )
    );
    const mAfter = await coins(m.token);
    if (mAfter - mBefore !== mission.rewardCoins) {
      missionBad++;
      console.log(`  [mission รอบ ${i}] ได้ +${mAfter - mBefore} แทน +${mission.rewardCoins}`);
    }
  }

  // --- gift overdraw race: 100 coins, 8 concurrent gifts of 100 -> only one may succeed ---
  const g = await reg(`gf${i}`);
  const statuses = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      fetch(`${B}/api/characters/${publicCharacterId}/gift`, {
        method: 'POST',
        headers: auth(g.token),
        body: JSON.stringify({ amount: 100 }),
      }).then(r => r.status)
    )
  );
  const gAfter = await coins(g.token);
  const succeeded = statuses.filter(s => s === 201).length;
  if (gAfter < 0 || succeeded !== 1) {
    giftBad++;
    console.log(`  [gift รอบ ${i}] สำเร็จ ${succeeded} ครั้ง, ยอดเหลือ ${gAfter}`);
  }

  // --- legacy leaderboard gift route must have the same atomic debit boundary ---
  const lg = await reg(`lg${i}`);
  const lBefore = await coins(lg.token);
  const malformedStatuses = await Promise.all(
    [-100, 1.5, '100', 1_000_001].map(amount =>
      fetch(`${B}/api/leaderboard/gifts`, {
        method: 'POST',
        headers: auth(lg.token),
        body: JSON.stringify({ characterId: publicCharacterId, amount }),
      }).then(r => r.status)
    )
  );
  if (malformedStatuses.some(status => status !== 400) || await coins(lg.token) !== lBefore) {
    malformedGiftBad++;
    console.log(`  [leaderboard malformed gift round ${i}] statuses=${malformedStatuses.join(',')}`);
  }
  const legacyStatuses = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      fetch(`${B}/api/leaderboard/gifts`, {
        method: 'POST',
        headers: auth(lg.token),
        body: JSON.stringify({ characterId: publicCharacterId, amount: 100 }),
      }).then(r => r.status)
    )
  );
  const lAfter = await coins(lg.token);
  const legacySucceeded = legacyStatuses.filter(s => s === 200).length;
  if (lAfter < 0 || legacySucceeded !== 1 || lBefore - lAfter !== 100) {
    legacyGiftBad++;
    console.log(`  [leaderboard gift round ${i}] succeeded=${legacySucceeded}, balance=${lAfter}`);
  }
}

console.log(`\ncheck-in  : ${ROUNDS - checkinBad}/${ROUNDS} รอบถูกต้อง`);
console.log(`mission   : ${ROUNDS - missionBad}/${ROUNDS} รอบถูกต้อง`);
console.log(`gift      : ${ROUNDS - giftBad}/${ROUNDS} รอบถูกต้อง (ยอดต้องไม่ติดลบ และสำเร็จได้ครั้งเดียว)`);
console.log(`legacy gift: ${ROUNDS - legacyGiftBad}/${ROUNDS} รอบถูกต้อง (ยอดต้องไม่ติดลบ และสำเร็จได้ครั้งเดียว)`);
console.log(`invalid gift: ${ROUNDS - malformedGiftBad}/${ROUNDS} 轮拒绝非法金额且余额不变`);
console.log(checkinBad + missionBad + giftBad + legacyGiftBad + malformedGiftBad === 0 ? '\n不变量检查通过' : '\n仍有余额或输入校验问题');
process.exit(checkinBad + missionBad + giftBad + legacyGiftBad + malformedGiftBad === 0 ? 0 : 1);
