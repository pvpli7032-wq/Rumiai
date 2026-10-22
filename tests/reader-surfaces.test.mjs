import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 表 15 前台补的三处：角色详情「可用模型与费用」、聊天页「分享」「评理」入口、首页「他眼中的你」。
 *
 * 覆盖：费用只在 billing 里算（与 /api/me/quota 同源，关收费不写 0 币）、模型清单与生成侧同源、
 * 分享链接只属于对话主人且落地页真的出内容、首页入口开关与站点内容覆盖、不要的区块不生效。
 */

const file = `reader-surfaces-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
// 模型目录会在读取时解密供应商密钥，缺这个变量整批模型会被静默丢掉。
process.env.AI_PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {signToken} = await import('../src/lib/auth.ts');
const {saveGroup} = await import('../src/lib/settings/service.ts');
const {clearCache} = await import('../src/lib/settings/cache.ts');
const {readReplyPlan} = await import('../src/lib/billing/reader-plan.ts');
const {GET: planRoute} = await import('../src/app/api/characters/reply-plan/route.ts');
const {POST: shareRoute} = await import('../src/app/api/conversations/[id]/share/route.ts');
const {readHomeCopyOverrides} = await import('../src/lib/site-content/home-copy.ts');

async function setSetting(key, value, group) {
  await saveGroup({group, changes: [{key, value}], expectedVersions: {}, operatorId: 'reader-surfaces'});
  clearCache();
}

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

async function fixture() {
  const owner = await db.user.create({data: {username: 'surfaces_' + randomUUID().slice(0, 8), email: randomUUID() + '@example.invalid', passwordHash: 'synthetic-only'}});
  const stranger = await db.user.create({data: {username: 'surfaces_' + randomUUID().slice(0, 8), email: randomUUID() + '@example.invalid', passwordHash: 'synthetic-only'}});
  // 角色默认不受模型范围限制；本文件要断言「可选项」就必须显式收窄，否则 reads 会走全站模型。
  const {encryptProviderSecret} = await import('../src/lib/ai/providers/secret.ts');
  const provider = await db.aiProvider.create({data: {name: 'p-' + randomUUID().slice(0, 6), baseUrl: 'https://provider.example.invalid', ...encryptProviderSecret('synthetic-key'), isActive: true}});
  const cheap = await db.aiModel.create({data: {key: 'cheap-' + randomUUID().slice(0, 6), displayName: '省钱模型', modelCode: 'm1', providerId: provider.id, isActive: true, isDefault: false, sortOrder: 1}});
  const good = await db.aiModel.create({data: {key: 'good-' + randomUUID().slice(0, 6), displayName: '旗舰模型', modelCode: 'm2', providerId: provider.id, isActive: true, isDefault: true, sortOrder: 0}});
  await db.modelCoinPrice.create({data: {modelId: cheap.id, coinsPerReply: 3, effectiveAt: new Date('2026-01-01T00:00:00.000Z'), createdBy: owner.id}});
  await db.modelCoinPrice.create({data: {modelId: good.id, coinsPerReply: 8, effectiveAt: new Date('2026-01-01T00:00:00.000Z'), createdBy: owner.id}});
  const character = await db.character.create({data: {name: '测试角色', personality: '冷静', background: '背景', greeting: '你好', creatorId: owner.id, isPublic: true, reviewStatus: 'APPROVED', aiModelsRestricted: true}});
  await db.characterAiModel.create({data: {characterId: character.id, modelKey: cheap.key}});
  await db.characterAiModel.create({data: {characterId: character.id, modelKey: good.key}});
  return {owner, stranger, character, cheap, good};
}

async function authed(user) {
  const token = await signToken({userId: user.id, email: user.email});
  return new Request('http://localhost/api/x', {headers: {Authorization: 'Bearer ' + token}});
}

test('角色详情费用：模型清单与生成侧同源，币价来自 quoteReplyPrice', async () => {
  const {owner, character, cheap, good} = await fixture();
  await setSetting('billing.chargingEnabled', true, 'billing');
  const plan = await readReplyPlan(character.id);
  assert.deepEqual(plan.models.map(line => line.modelKey).sort(), [cheap.key, good.key].sort());
  assert.equal(plan.defaultModelKey, good.key, '默认模型要与 readAiModelCatalog 的 default 一致');
  const cheapLine = plan.models.find(line => line.modelKey === cheap.key);
  assert.equal(cheapLine.coins, 3);
  assert.equal(cheapLine.pricing, 'CHARGED');
  assert.equal(cheapLine.priceSource, 'MODEL_PRICE');
  assert.equal(plan.defaultLine.coins, 8);
  assert.equal(plan.chargingEnabled, true);
  assert.ok(owner.id);
});

test('角色详情费用：收费关闭时不给出 0 币价，交给前台说「当前免费」', async () => {
  const {character} = await fixture();
  await setSetting('billing.chargingEnabled', false, 'billing');
  const plan = await readReplyPlan(character.id);
  assert.equal(plan.chargingEnabled, false);
  assert.ok(plan.models.length > 0);
  for (const line of plan.models) {
    assert.equal(line.pricing, 'FREE_MODE');
    assert.equal(line.coins, 0);
  }
});

test('角色详情费用：倍率只由 billing 应用，页面与接口不自算', async () => {
  const {owner, character} = await fixture();
  await setSetting('billing.chargingEnabled', true, 'billing');
  await saveGroup({group: 'billing', changes: [{key: 'billing.priceMultiplier', value: 1500}], expectedVersions: {}, operatorId: owner.id});
  clearCache();
  const plan = await readReplyPlan(character.id);
  const line = plan.models.find(item => item.baseCoins === 8);
  assert.equal(line.multiplier, 1500);
  assert.equal(line.coins, 12, 'ceil(8 × 1500 / 1000) = 12');
});

test('角色详情费用接口：400 与 200 的返回结构', async () => {
  const {character} = await fixture();
  const bad = await planRoute(new Request('http://localhost/api/characters/reply-plan'));
  assert.equal(bad.status, 400);
  const ok = await planRoute(new Request('http://localhost/api/characters/reply-plan?characterId=' + encodeURIComponent(character.id)));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(typeof body.chargingEnabled, 'boolean');
  assert.ok(Array.isArray(body.models));
  assert.equal(typeof body.models[0].displayName, 'string');
});

test('分享对话：需要登录、只属于对话主人', async () => {
  const {owner, stranger, character} = await fixture();
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id, title: '一段对话'}});
  await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: '在吗'}});
  await db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: '在。'}});

  const anonymous = await shareRoute(new Request('http://localhost/api/x', {method: 'POST'}), {params: Promise.resolve({id: conversation.id})});
  assert.equal(anonymous.status, 401);

  const other = await shareRoute(await authed(stranger), {params: Promise.resolve({id: conversation.id})});
  assert.equal(other.status, 404, '别人的对话连存在都不确认');

  const ok = await shareRoute(await authed(owner), {params: Promise.resolve({id: conversation.id})});
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.match(body.path, new RegExp('/share/chat/' + conversation.id + '$'));
  assert.equal(body.turnCount, 2);
  assert.equal(body.characterName, character.name);
});

test('分享对话：空对话不生成链接', async () => {
  const {owner, character} = await fixture();
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id}});
  const response = await shareRoute(await authed(owner), {params: Promise.resolve({id: conversation.id})});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'EMPTY');
});

test('首页文案：没配 home 页面时完全回落字典', async () => {
  assert.deepEqual(await readHomeCopyOverrides(), {});
});
test('首页文案：按区块覆盖标题、副标题、两个按钮与「他眼中的你」卡片', async () => {
  await db.sitePage.create({data: {slug: 'home', kind: 'PAGE', title: '首页', summary: '', sortOrder: 0, isActive: true, blocksJson: JSON.stringify([
    {type: 'PARAGRAPH', text: '后台配的主标题'},
    {type: 'PARAGRAPH', text: '后台配的副标题'},
    {type: 'BUTTON', text: '立刻开始', href: '/th/auth', variant: 'PRIMARY'},
    {type: 'BUTTON', text: '先逛逛', href: '/th/explore', variant: 'SECONDARY'},
    {type: 'CARD_GRID', heading: '玩法', cards: [{title: 'TA 眼中的你', description: '答三题看看', href: '/th/mirror', actionLabel: '开始测试'}]},
  ])}});
  const overrides = await readHomeCopyOverrides();
  assert.equal(overrides.headline, '后台配的主标题');
  assert.equal(overrides.subhead, '后台配的副标题');
  assert.equal(overrides.primaryCta, '立刻开始');
  assert.equal(overrides.secondaryCta, '先逛逛');
  assert.equal(overrides.mirrorTitle, 'TA 眼中的你');
  assert.equal(overrides.mirrorBody, '答三题看看');
  assert.equal(overrides.mirrorCta, '开始测试');
});
test('首页文案：下架的 home 页面不生效', async () => {
  await db.sitePage.update({where: {slug: 'home'}, data: {isActive: false, blocksJson: JSON.stringify([{type: 'PARAGRAPH', text: '不该出现'}])}});
  assert.deepEqual(await readHomeCopyOverrides(), {});
});
