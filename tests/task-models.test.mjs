import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 每个 AI 任务可选模型（V3 §22 表 18）。
 *
 * 三条硬要求各一条用例：留空与原来的全局模型计划逐字一致；填了在售模型就排到候选链最前；
 * 填了不存在的 key 回落并记警告，绝不抛错把任务打挂。
 */
const file = `task-models-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {readAiModelPlan} = await import('../src/lib/ai/models/runtime-service.ts');
const {readTaskModelPlan, readTaskModelKey, AI_TASK_NAMES} = await import('../src/lib/ai/models/task-models.ts');
const {saveChanges} = await import('../src/lib/settings/service.ts');
const {readAdminCoinPrices} = await import('../src/lib/admin/coin-prices-admin.ts');

const {encryptProviderSecret} = await import('../src/lib/ai/providers/secret.ts');
const provider = await db.aiProvider.create({
  data: {name: '任务模型供应商', baseUrl: 'https://example.invalid/v1', isActive: true, ...encryptProviderSecret('task-model-synthetic-key')},
});
const model = (key, extra = {}) => db.aiModel.create({
  data: {key, displayName: key.toUpperCase(), modelCode: key, providerId: provider.id, isActive: true, ...extra},
});
await model('task-default', {isDefault: true, sortOrder: 0});
await model('task-backup', {isFallback: true, sortOrder: 1});
await model('task-pick', {sortOrder: 2});
await model('task-off', {isActive: false, sortOrder: 3});

/** 只保存设置，不额外造第二套写入路径。 */
const setTaskModel = (key, value) => saveChanges({changes: [{key, value}], expectedVersions: {}, operatorId: 'test-operator'});

/** 捕获 console.warn 输出，用来断言「记了一条警告」。 */
function captureWarnings() {
  const lines = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return true; };
  return {lines, restore: () => { process.stderr.write = original; }};
}

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

test('留空：五个任务都原样返回全局模型计划，一个字段都不差', async () => {
  for (const task of AI_TASK_NAMES) {
    assert.equal(await readTaskModelKey(task), '', `${task} 默认未配置`);
    const viaTask = await readTaskModelPlan(task, {preferred: null, characterId: undefined});
    const direct = await readAiModelPlan(null, undefined);
    assert.deepEqual(viaTask, direct, `${task} 留空时必须与 readAiModelPlan 完全一致`);
  }
  // 带首选模型（聊天的 conversation.aiModel）时同样一致。
  const viaTask = await readTaskModelPlan('chat', {preferred: 'task-pick'});
  const direct = await readAiModelPlan('task-pick', undefined);
  assert.deepEqual(viaTask, direct);
  assert.equal(viaTask[0].key, 'task-pick');
});

test('填了在售模型：该模型排到候选链最前，默认与兜底仍在后面', async () => {
  await setTaskModel('ai.taskModel.chat', 'task-pick');
  const plan = await readTaskModelPlan('chat', {preferred: 'task-default'});
  assert.equal(plan[0].key, 'task-pick', '任务模型优先于会话首选模型');
  assert.deepEqual(plan.map(item => item.key), ['task-pick', 'task-default', 'task-backup']);
  // 只影响自己那个任务：其他任务仍然走默认计划。
  const mirror = await readTaskModelPlan('mirror', {characterId: undefined});
  assert.deepEqual(mirror, await readAiModelPlan(null, undefined));
});

test('填了不存在的 key：回落默认计划并记一条警告，不抛错', async () => {
  await setTaskModel('ai.taskModel.memorySummary', 'not-a-model');
  const capture = captureWarnings();
  let plan;
  try {
    plan = await readTaskModelPlan('memorySummary', {characterId: undefined});
  } finally {
    capture.restore();
  }
  assert.deepEqual(plan, await readAiModelPlan(null, undefined), '必须回落到默认计划');
  const warning = capture.lines.map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
  const hit = warning.find(item => item.message === 'ai_task_model_unavailable');
  assert.ok(hit, '必须记 ai_task_model_unavailable 警告');
  assert.equal(hit.task, 'memorySummary');
  assert.equal(hit.model, 'not-a-model');
  assert.equal(hit.reason, 'UNKNOWN_KEY');
});

test('填了已停用的模型：同样回落并记警告', async () => {
  await setTaskModel('ai.taskModel.mirror', 'task-off');
  const capture = captureWarnings();
  let plan;
  try {
    plan = await readTaskModelPlan('mirror', {characterId: undefined});
  } finally {
    capture.restore();
  }
  assert.deepEqual(plan, await readAiModelPlan(null, undefined));
  const warning = capture.lines.map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
  assert.equal(warning.find(item => item.message === 'ai_task_model_unavailable')?.reason, 'UNKNOWN_KEY');
});

test('清空回「沿用默认」：空串是合法状态，读回即空', async () => {
  await setTaskModel('ai.taskModel.chat', 'task-pick');
  assert.equal(await readTaskModelKey('chat'), 'task-pick');
  await setTaskModel('ai.taskModel.chat', '');
  assert.equal(await readTaskModelKey('chat'), '');
  assert.deepEqual(await readTaskModelPlan('chat', {preferred: null}), await readAiModelPlan(null, undefined));
});

test('后台读取：五个任务各自的选择与在售模型列表一起返回', async () => {
  await setTaskModel('ai.taskModel.story', 'task-pick');
  const view = await readAdminCoinPrices();
  assert.deepEqual(view.taskModels.map(item => item.task), ['chat', 'story', 'mirror', 'disputeVerdict', 'memorySummary']);
  assert.equal(view.taskModels.find(item => item.task === 'story').modelKey, 'task-pick');
  assert.equal(view.taskModels.find(item => item.task === 'chat').modelKey, '');
  const pick = view.modelOptions.find(item => item.key === 'task-pick');
  assert.equal(pick?.available, true);
  assert.equal(view.modelOptions.find(item => item.key === 'task-off')?.available, false);
});
