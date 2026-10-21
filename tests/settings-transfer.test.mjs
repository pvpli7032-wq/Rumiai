import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 设置导出 / 导入 / 提示词试生成（V3 表 10 与 §16）。
 *
 * 覆盖：导出只含公共值且不含凭据、导入预览不写库、导入确认走同一条写路径并跳过无变化项、
 * 未登记键整批拒绝、试生成在没有模型路由时如实报错而不是假成功。
 */
const file = `settings-transfer-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner} = await import('../src/lib/admin/management-service.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {SETTINGS_BY_KEY} = await import('../src/lib/settings/registry.ts');
const {clearKeyEverywhere} = await import('../src/lib/settings/cache.ts');
const {GET: exportSettings} = await import('../src/app/api/admin/settings/export/route.ts');
const {POST: previewImport} = await import('../src/app/api/admin/settings/import/route.ts');
const {POST: confirmImport} = await import('../src/app/api/admin/settings/import/confirm/route.ts');
const {POST: previewPrompt} = await import('../src/app/api/admin/settings/prompts/preview/route.ts');
const {GET: readGroupRoute, PATCH: patchGroup} = await import('../src/app/api/admin/settings/route.ts');

const owner = await db.user.create({data: {username: 'transfer_owner', email: 'transfer-owner@example.invalid', passwordHash: 'synthetic-only'}});
await bootstrapOwner(owner.email);
const outsider = await db.user.create({data: {username: 'transfer_guest', email: 'transfer-guest@example.invalid', passwordHash: 'synthetic-only'}});
const tokens = new Map();
for (const user of [owner, outsider]) tokens.set(user.id, await signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion}));

const req = (user, url, body) => new Request(`http://localhost${url}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: {...(user ? {Authorization: `Bearer ${tokens.get(user.id)}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
  ...(body === undefined ? {} : {body: JSON.stringify(body)}),
});

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

/** 与设置中心同一条写入路径：写 operation_settings 并让读取缓存失效。 */
async function setSetting(key, value) {
  const definition = SETTINGS_BY_KEY[key];
  await db.operationSetting.upsert({
    where: {key},
    create: {key, group: definition.group, value: JSON.stringify(value), version: 1, updatedBy: 'test-operator'},
    update: {value: JSON.stringify(value), version: {increment: 1}, updatedBy: 'test-operator'},
  });
  clearKeyEverywhere(key);
}

test('导出：只含登记表的公共值，不含用户特例与任何凭据字段', async () => {
  const response = await exportSettings(req(owner, '/api/admin/settings/export'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename="settings-\d{4}-\d{2}-\d{2}\.json"/);
  const payload = await response.json();
  assert.equal(payload.version, 1);
  assert.ok(Date.parse(payload.exportedAt) > 0);
  assert.deepEqual(Object.keys(payload.values).sort(), Object.keys(SETTINGS_BY_KEY).sort(), '导出应覆盖全部登记键');

  // 用户特例不导出：给某项设 USER 覆盖后，导出仍是公共值。
  await setSetting('chat.maxMessageChars', 4321);
  await db.userSettingOverride.create({data: {userId: outsider.id, key: 'billing.hardDailyMessages', value: '7', version: 1, expiresAt: null, updatedBy: owner.id}});
  clearKeyEverywhere('billing.hardDailyMessages');
  const again = await (await exportSettings(req(owner, '/api/admin/settings/export'))).json();
  assert.equal(again.values['chat.maxMessageChars'], 4321);
  assert.equal(again.values['billing.hardDailyMessages'], SETTINGS_BY_KEY['billing.hardDailyMessages'].default, '不得带出用户特例');

  // 凭据类字段不在参数登记表里（它们存在各自的业务表），所以文件里也不可能有。
  // accounts.passwordMinLength 这类是策略数值，不是凭据本身。
  const credentialKeys = Object.keys(again.values).filter(key => /apikey|api_key|secret|merchant|database|passwd|credential/i.test(key));
  assert.deepEqual(credentialKeys, [], '导出不应包含任何凭据字段');
  for (const key of ['aiModel.apiKey', 'payment.merchantKey', 'database.url']) {
    assert.equal(key in again.values, false, '导出不应包含 ' + key);
  }
});

test('导入预览：只算差异不写库，未登记键标成 unknown-key', async () => {
  await setSetting('content.post.maxChars', 5000);
  const before = await db.operationSetting.findUnique({where: {key: 'content.comment.maxChars'}});
  const response = await previewImport(req(owner, '/api/admin/settings/import', {values: {
    'content.post.maxChars': 5000,
    'content.comment.maxChars': 1234,
    'nope.unknownKey': 1,
  }}));
  assert.equal(response.status, 200);
  const payload = await response.json();
  const byKey = Object.fromEntries(payload.items.map(row => [row.key, row]));
  assert.equal(byKey['content.post.maxChars'].action, 'same');
  assert.equal(byKey['content.comment.maxChars'].action, 'change');
  assert.equal(byKey['content.comment.maxChars'].current, before ? JSON.parse(before.value) : SETTINGS_BY_KEY['content.comment.maxChars'].default);
  assert.equal(byKey['nope.unknownKey'].action, 'unknown-key');
  assert.equal(byKey['nope.unknownKey'].current, null);
  assert.deepEqual(payload.counts, {'change': 1, 'same': 1, 'unknown-key': 1});

  // 预览不写库。
  assert.equal(await db.operationSetting.findUnique({where: {key: 'content.comment.maxChars'}}), null);
});

test('导入确认：写入变化项、跳过无变化项，并留下历史记录', async () => {
  await setSetting('content.post.maxChars', 5000);
  const values = {'content.post.maxChars': 5000, 'content.comment.maxChars': 1234};
  const preview = await (await previewImport(req(owner, '/api/admin/settings/import', {values}))).json();
  const expectedVersions = Object.fromEntries(preview.items.map(row => [row.key, row.version]));

  const response = await confirmImport(req(owner, '/api/admin/settings/import/confirm', {values, expectedVersions}));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.saved, ['content.comment.maxChars'], '只写真正变化的项');
  assert.equal(result.skipped, 1);

  const stored = await db.operationSetting.findUnique({where: {key: 'content.comment.maxChars'}});
  assert.equal(JSON.parse(stored.value), 1234);
  assert.equal(stored.updatedBy, owner.id);
  const revision = await db.settingRevision.findFirst({where: {key: 'content.comment.maxChars'}, orderBy: {createdAt: 'desc'}});
  assert.equal(revision.scope, 'GLOBAL');
  assert.equal(revision.operatorId, owner.id);
});

test('导入确认：含未登记键时整批拒绝，一项都不写', async () => {
  const values = {'content.comment.maxChars': 999, 'nope.unknownKey': 1};
  const response = await confirmImport(req(owner, '/api/admin/settings/import/confirm', {values}));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /未登记的设置键/);
  assert.equal(payload.key, 'nope.unknownKey');
  const stored = await db.operationSetting.findUnique({where: {key: 'content.comment.maxChars'}});
  assert.equal(JSON.parse(stored.value), 1234, '整批拒绝后原值不变');
});

test('导入确认：版本冲突整体回滚，校验失败带 key', async () => {
  const values = {'content.comment.maxChars': 2001, 'content.post.maxChars': 6000};
  const conflict = await confirmImport(req(owner, '/api/admin/settings/import/confirm', {values, expectedVersions: {'content.comment.maxChars': 0}}));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).key, 'content.comment.maxChars');
  assert.equal(await db.operationSetting.findUnique({where: {key: 'content.post.maxChars'}}).then(row => JSON.parse(row.value)), 5000, '冲突时另一项也不写入');

  const invalid = await confirmImport(req(owner, '/api/admin/settings/import/confirm', {values: {'chat.maxMessageChars': -5}}));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).key, 'chat.maxMessageChars');
});

test('分组 PATCH 行为不变：写入、版本冲突、跨组拒绝、历史记录', async () => {
  const saved = await patchGroup(req(owner, '/api/admin/settings', {group: 'chat', changes: [{key: 'chat.maxMessageChars', value: 2345}], expectedVersions: {}}));
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.deepEqual(result.saved, ['chat.maxMessageChars']);
  assert.equal(typeof result.versions['chat.maxMessageChars'], 'number');

  const version = result.versions['chat.maxMessageChars'];
  const conflict = await patchGroup(req(owner, '/api/admin/settings', {group: 'chat', changes: [{key: 'chat.maxMessageChars', value: 3456}], expectedVersions: {}}));
  assert.equal(conflict.status, 200, '不传版本号时不校验并发');
  const stale = await patchGroup(req(owner, '/api/admin/settings', {group: 'chat', changes: [{key: 'chat.maxMessageChars', value: 4567}], expectedVersions: {'chat.maxMessageChars': version - 1}}));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).key, 'chat.maxMessageChars');

  const wrongGroup = await patchGroup(req(owner, '/api/admin/settings', {group: 'chat', changes: [{key: 'prompt.memorySummary', value: '不属于聊天分组'}]}));
  assert.equal(wrongGroup.status, 400, '分组校验留在 saveGroup，不属于本组的键仍然拒绝');

  const invalid = await patchGroup(req(owner, '/api/admin/settings', {group: 'chat', changes: [{key: 'chat.maxMessageChars', value: -1}]}));
  assert.equal(invalid.status, 400);

  const revisions = await db.settingRevision.count({where: {key: 'chat.maxMessageChars', scope: 'GLOBAL'}});
  assert.ok(revisions >= 2, '每次成功写入都留一条历史');

  const read = await readGroupRoute(req(owner, '/api/admin/settings?group=chat'));
  assert.equal(read.status, 200);
  const payload = await read.json();
  assert.equal(payload.values.find(item => item.key === 'chat.maxMessageChars').value, 3456);
});

test('鉴权：未登录 401，无权限 403', async () => {
  assert.equal((await exportSettings(req(null, '/api/admin/settings/export'))).status, 401);
  assert.equal((await exportSettings(req(outsider, '/api/admin/settings/export'))).status, 403);
  assert.equal((await previewImport(req(outsider, '/api/admin/settings/import', {values: {}}))).status, 403);
  assert.equal((await confirmImport(req(outsider, '/api/admin/settings/import/confirm', {values: {}}))).status, 403);
  assert.equal((await previewPrompt(req(outsider, '/api/admin/settings/prompts/preview', {key: 'prompt.memorySummary', sample: '示例'}))).status, 403);
});

test('提示词试生成：真实调用并记 AiCall，失败如实返回原因且不扣币', async () => {
  const coinsBefore = await db.coinTransaction.count();
  const response = await previewPrompt(req(owner, '/api/admin/settings/prompts/preview', {key: 'prompt.memorySummary', sample: '用户：你好'}));
  // 隔离库里没有可用的上游供应商：必须如实失败，不能拿占位文本冒充生成结果。
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(typeof payload.error, 'string');
  assert.ok(payload.error.length > 0);
  assert.equal(payload.result, undefined, '失败时不得返回结果文本');
  assert.equal(payload.code, 'UPSTREAM_HTTP_401');

  const call = await db.aiCall.findFirst({where: {operation: 'PROMPT_PREVIEW'}, orderBy: {startedAt: 'desc'}});
  assert.ok(call, '试生成必须留下 AiCall 记录');
  assert.equal(call.userId, owner.id);
  assert.equal(call.status, 'FAILED');
  assert.equal(call.errorCode, 'UPSTREAM_HTTP_401');
  assert.equal(await db.coinTransaction.count(), coinsBefore, '试生成不扣币');

  const notText = await previewPrompt(req(owner, '/api/admin/settings/prompts/preview', {key: 'chat.maxMessageChars', sample: '示例'}));
  assert.equal(notText.status, 400);
  const missingSample = await previewPrompt(req(owner, '/api/admin/settings/prompts/preview', {key: 'prompt.memorySummary', sample: '   '}));
  assert.equal(missingSample.status, 400);
});
