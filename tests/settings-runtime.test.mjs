import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
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
