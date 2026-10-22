import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

/**
 * M1 验收「配置保存」：后台改一项设置，下一次真实请求就按新值校验/限额。
 *
 * 这里走真实链路：设置写入 operation_settings（与设置中心同一条表），
 * 再调用实际业务函数（发帖校验、角色校验、注册、每日请求上限），不 mock 读取层。
 */
const file = `settings-runtime-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(path.resolve('prisma', file));

const {db} = await import('../src/lib/db.ts');
const {clearKeyEverywhere} = await import('../src/lib/settings/cache.ts');
const {validatePostContent} = await import('../src/lib/posts/validation.ts');
const {validateCharacter} = await import('../src/lib/characters/validation.ts');
const {registerAccount, AccountRegistrationError} = await import('../src/lib/accounts/registration-service.ts');
const {reserveAiCall, AiQuotaError} = await import('../src/lib/ai/ai-usage.ts');
const {readChatRules} = await import('../src/lib/settings/limits.ts');
const {POST: login} = await import('../src/app/api/auth/login/route.ts');
const {readSetting, readSettingValue} = await import('../src/lib/settings/service.ts');
const {quoteReplyPrice} = await import('../src/lib/billing/price.ts');

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

/** 与设置中心同一条写入路径：写 operation_settings 并让读取缓存失效。 */
async function setSetting(key, value, group = 'chat') {
  await db.operationSetting.upsert({
    where: {key},
    create: {key, group, value: JSON.stringify(value), version: 1, updatedBy: 'test-operator'},
    update: {value: JSON.stringify(value), version: {increment: 1}, updatedBy: 'test-operator'},
  });
  clearKeyEverywhere(key);
}

test('发帖字数上限：改设置后同一段内容从拒绝变通过，再改回又拒绝', async () => {
  const text = '一二三四五六七八九十'; // 10 字
  await setSetting('content.post.maxChars', 5);
  await assert.rejects(() => validatePostContent(text), /不能超过 5 字符/);
  await setSetting('content.post.maxChars', 20);
  assert.equal(await validatePostContent(text), text);
  await setSetting('content.post.maxChars', 5);
  await assert.rejects(() => validatePostContent(text), /不能超过 5 字符/);
});

test('角色名称上限：改设置后校验按新值执行', async () => {
  await setSetting('content.character.nameMax', 3);
  const rejected = await validateCharacter({name: '四个字的名字', personality: '冷静'}, true);
  assert.match(rejected.error ?? '', /角色名称不能超过 3 字/);
  await setSetting('content.character.nameMax', 40);
  const accepted = await validateCharacter({name: '四个字的名字', personality: '冷静'}, true);
  assert.equal(accepted.error, undefined);
  assert.equal(accepted.data.name, '四个字的名字');
});

test('注册：密码位数与注册赠币按设置执行', async () => {
  await setSetting('accounts.passwordMinLength', 12, 'accounts');
  await setSetting('grant.signupBonusCoins', 250, 'growth');
  const suffix = randomUUID().slice(0, 8);
  await assert.rejects(
    () => registerAccount({email: `short-${suffix}@example.invalid`, username: `short${suffix}`, password: 'Local123'}),
    error => error instanceof AccountRegistrationError && error.status === 400 && /at least 12/.test(error.message),
  );
  const created = await registerAccount({email: `long-${suffix}@example.invalid`, username: `long${suffix}`, password: 'Local12345678'});
  assert.equal(created.coins, 250, '注册赠币取设置值，不是写死的 100');
});

test('每日请求上限：0 表示暂停新请求，改大后同一天继续放行', async () => {
  const name = randomUUID().slice(0, 8);
  const user = await db.user.create({data: {username: `quota_${name}`, email: `quota-${name}@example.invalid`, passwordHash: 'synthetic', coins: 10}});
  const character = await db.character.create({data: {creatorId: user.id, name: '额度角色', personality: '平静', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const conversation = await db.conversation.create({data: {userId: user.id, characterId: character.id}});

  await setSetting('billing.hardDailyMessages', 0);
  await assert.rejects(() => reserveAiCall(user.id, conversation.id, 'SEND'), error => error instanceof AiQuotaError && error.status === 429);

  await setSetting('billing.hardDailyMessages', 2);
  await reserveAiCall(user.id, conversation.id, 'SEND');
  await reserveAiCall(user.id, conversation.id, 'SEND');
  await assert.rejects(() => reserveAiCall(user.id, conversation.id, 'SEND'), error => error instanceof AiQuotaError);
});

test('聊天规则：发送次数与窗口长度来自设置，不是环境变量', async () => {
  await setSetting('limits.chat.perWindow', 7);
  await setSetting('limits.chat.windowSeconds', 90);
  await setSetting('chat.maxMessageChars', 1234);
  await setSetting('chat.historyMessages', 9);
  const rules = await readChatRules();
  assert.deepEqual(rules, {maxMessageChars: 1234, historyMessages: 9, perWindow: 7, windowMs: 90_000});
});

/**
 * 登录频率：阈值与窗口来自设置，分桶键是来源而不是全局计数。
 *
 * 用错密码打登录：前 perWindow 次会走到业务层拿 401（说明真的尝试了），
 * 第 perWindow+1 次被限流拦在 429。换一个来源不受影响 —— 若把键写成常量，
 * 第二个来源也会被 429，这条断言就会失败。
 */
test('登录频率：按来源分桶，阈值与窗口来自设置', async () => {
  await setSetting('limits.login.perWindow', 2);
  await setSetting('limits.login.windowSeconds', 60);
  const attempt = ip => login(new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-real-ip': ip},
    body: JSON.stringify({email: 'login-limit@example.invalid', password: 'wrong-password'}),
  }));
  assert.equal((await attempt('203.0.113.10')).status, 401);
  assert.equal((await attempt('203.0.113.10')).status, 401);
  const blocked = await attempt('203.0.113.10');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0, '限流响应要告诉客户端等多久');
  assert.equal((await attempt('203.0.113.11')).status, 401, '换来源不该被上一个来源的计数连坐');
});

/**
 * V3 表 25「用户覆盖」：用户特例只影响本人、到期回落、删除后回落。
 *
 * 挑 billing.priceMultiplier 是因为它 userOverridable，且被真实业务函数
 * quoteReplyPrice 按 userId 读取 —— 断言既能落在读取入口，也能落在一处真实计价上。
 * 三个用例都走 readSetting / quoteReplyPrice，不直接查表比字符串。
 */
const MULTIPLIER_KEY = 'billing.priceMultiplier';

/** 写一条用户特例并让该键的所有用户视图缓存失效（与设置中心写后失效同一条路径）。 */
async function setUserOverride(userId, value, expiresAt = null) {
  await db.userSettingOverride.upsert({
    where: {userId_key: {userId, key: MULTIPLIER_KEY}},
    create: {userId, key: MULTIPLIER_KEY, value: JSON.stringify(value), version: 1, updatedBy: 'test-operator', expiresAt},
    update: {value: JSON.stringify(value), version: {increment: 1}, updatedBy: 'test-operator', expiresAt},
  });
  clearKeyEverywhere(MULTIPLIER_KEY);
}

async function makeUser(label) {
  const suffix = randomUUID().slice(0, 8);
  return db.user.create({data: {username: `${label}_${suffix}`, email: `${label}-${suffix}@example.invalid`, passwordHash: 'synthetic'}});
}

test('用户特例只影响该用户：A 读到特例，B 仍读到公共值', async () => {
  await setSetting(MULTIPLIER_KEY, 1200, 'billing');
  const [a, b] = await Promise.all([makeUser('override_a'), makeUser('override_b')]);
  await setUserOverride(a.id, 0);

  const forA = await readSetting(MULTIPLIER_KEY, a.id);
  assert.equal(forA.value, 0, 'A 读到自己的特例');
  assert.equal(forA.source, 'USER');

  const forB = await readSetting(MULTIPLIER_KEY, b.id);
  assert.equal(forB.value, 1200, 'B 读到公共值，不受 A 的特例影响');
  assert.equal(forB.source, 'GLOBAL');

  // 落到真实计价上：A 的倍率是 0（免费），B 是公共的 1200。
  const [quoteA, quoteB] = await Promise.all([
    quoteReplyPrice({userId: a.id, operation: 'SEND'}),
    quoteReplyPrice({userId: b.id, operation: 'SEND'}),
  ]);
  assert.equal(quoteA.multiplier, 0);
  assert.equal(quoteB.multiplier, 1200);
});

test('用户特例到期回落：未到期读特例，已过期读回公共值', async () => {
  await setSetting(MULTIPLIER_KEY, 1200, 'billing');
  const user = await makeUser('override_expiry');

  // 未到期：特例生效。
  await setUserOverride(user.id, 250, new Date(Date.now() + 3_600_000));
  const beforeExpiry = await readSetting(MULTIPLIER_KEY, user.id);
  assert.equal(beforeExpiry.value, 250);
  assert.equal(beforeExpiry.source, 'USER');

  // 已过期：同一个用户读回公共值，不是继续返回特例。
  await setUserOverride(user.id, 250, new Date(Date.now() - 3_600_000));
  const afterExpiry = await readSetting(MULTIPLIER_KEY, user.id);
  assert.equal(afterExpiry.value, 1200, '过期特例不再生效');
  assert.equal(afterExpiry.source, 'GLOBAL');
  assert.equal((await readSettingValue(MULTIPLIER_KEY, user.id)), 1200, '业务读取入口同样回落到公共值');
});

test('删除用户特例后回落：读回公共值，来源不再是 USER', async () => {
  await setSetting(MULTIPLIER_KEY, 1200, 'billing');
  const user = await makeUser('override_delete');
  await setUserOverride(user.id, 500);
  assert.equal((await readSetting(MULTIPLIER_KEY, user.id)).source, 'USER');

  await db.userSettingOverride.delete({where: {userId_key: {userId: user.id, key: MULTIPLIER_KEY}}});
  clearKeyEverywhere(MULTIPLIER_KEY);

  const after = await readSetting(MULTIPLIER_KEY, user.id);
  assert.equal(after.value, 1200);
  assert.equal(after.source, 'GLOBAL');
  assert.equal((await quoteReplyPrice({userId: user.id, operation: 'SEND'})).multiplier, 1200);
});

/**
 * V3 表 25「配置保存」的进程级证据。
 *
 * 前面的用例只证明「本进程写完立刻读得到、清缓存后仍读得到」——那还是同一个进程、
 * 同一个 PrismaClient、同一份内存。真正的「重启后仍保留」必须换一个进程去读。
 * 这里用 spawnSync 起一个全新的 node（--import tsx），连同一个测试库、调同一个读取入口，
 * 把结果写进临时文件再由父进程断言。临时脚本跑完即删，不留仓库。
 */
test('配置重启后仍保留：全新 node 进程连同一个库读回同样的值', async () => {
  const saved = 1300;
  await setSetting(MULTIPLIER_KEY, saved, 'billing');
  // 本进程先读一次，确保缓存里存的是新值而不是默认值。
  assert.equal(await readSettingValue(MULTIPLIER_KEY), saved);

  const stamp = `${process.pid}-${Date.now()}`;
  const scriptPath = path.resolve('tests', `.tmp-restart-read-${stamp}.mjs`);
  const outPath = path.resolve('tests', `.tmp-restart-out-${stamp}.json`);
  writeFileSync(scriptPath, [
    "const {readSetting} = await import('../src/lib/settings/service.ts');",
    "const {db} = await import('../src/lib/db.ts');",
    'const [key, out] = process.argv.slice(2);',
    'const setting = await readSetting(key);',
    'await db.$disconnect();',
    "const {writeFileSync} = await import('node:fs');",
    'writeFileSync(out, JSON.stringify({value: setting.value, source: setting.source, version: setting.version}));',
    '',
  ].join('\n'), 'utf8');

  const env = {...process.env};
  delete env.RUST_LOG;
  let child;
  try {
    child = spawnSync(process.execPath, ['--import', 'tsx', scriptPath, MULTIPLIER_KEY, outPath], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(child.status, 0, `子进程读取失败：${child.stdout}${child.stderr}`);
    const readBack = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(readBack.value, saved, '全新进程读到的是保存值，不是登记默认值');
    assert.equal(readBack.source, 'GLOBAL');
    assert.notEqual(readBack.value, 1000, '与登记默认值不同，证明确实来自数据库');
  } finally {
    for (const temp of [scriptPath, outPath]) rmSync(temp, {force: true});
  }
});
