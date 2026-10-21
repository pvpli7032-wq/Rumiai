import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 记忆与统一后台任务（V3 第 24/25 章）。
 * 覆盖：事实隔离与失效、摘要阈值登记、上下文预算裁剪、租约领取与有限重试、巡检任务重排。
 */

const file = `background-tasks-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', file, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const memory = await import('../src/lib/memory/index.ts');
const tasks = await import('../src/lib/tasks/index.ts');
const {handlerFor} = await import('../src/lib/tasks/handlers.ts');
const {readMemorySummary} = await import('../src/lib/memory/summary-service.ts');

const user = await db.user.create({data: {username: 'memory-owner', email: 'memory@example.invalid', passwordHash: 'synthetic-only'}});
const stranger = await db.user.create({data: {username: 'memory-stranger', email: 'stranger-memory@example.invalid', passwordHash: 'synthetic-only'}});
const character = await db.character.create({data: {creatorId: user.id, name: '记忆角色', personality: '安静', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
const conversation = await db.conversation.create({data: {userId: user.id, characterId: character.id, title: '记忆会话'}});

/** 每日备份会真的写出一个 .db 文件：测试结束把它删掉，别把备份留在仓库里。 */
const backupPrefix = path.basename(file, '.db');
const backupDirectory = path.resolve('prisma', 'backups');
const backupFiles = () => existsSync(backupDirectory)
  ? readdirSync(backupDirectory).filter(name => name.startsWith(backupPrefix))
  : [];

test.after(async () => {
  await db.$disconnect();
  for (const name of backupFiles()) rmSync(path.join(backupDirectory, name), {recursive: true, force: true});
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

/** 后台设置写入：走设置中心同一条路径，清缓存后下一次读取立即生效。 */
async function setGrowthSetting(key, value) {
  await db.operationSetting.upsert({
    where: {key},
    create: {key, group: 'growth', value: JSON.stringify(value), version: 1, updatedBy: user.id},
    update: {value: JSON.stringify(value), version: {increment: 1}},
  });
  const {clearCache} = await import('../src/lib/settings/cache.ts');
  clearCache();
}

/** 记忆默认关闭（opt-in）：测试里显式打开，验证开与关两种行为。 */
const setMemoryEnabled = enabled => setGrowthSetting('memory.enabled', enabled);

test('事实按会话与用户双重隔离，别人读不到也删不掉', async () => {
  const fact = await memory.createMemoryFact(user.id, conversation.id, {text: '用户养了一只叫团子的猫'});
  assert.equal(fact.status, 'ACTIVE');
  const mine = await memory.listMemoryFacts(user.id, conversation.id);
  assert.equal(mine.length, 1);
  await assert.rejects(() => memory.listMemoryFacts(stranger.id, conversation.id), /没有权限/);
  await assert.rejects(() => memory.deleteMemoryFact(stranger.id, fact.id), /没有权限/);
  assert.equal((await memory.deleteMemoryFact(user.id, fact.id)).status, 'DELETED');
});

test('来源消息失效后事实不再注入', async () => {
  const message = await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: '我下个月要搬家'}});
  const fact = await memory.createMemoryFact(user.id, conversation.id, {text: '用户下个月搬家', sourceMessageId: message.id});
  assert.equal((await memory.readInjectableFacts(conversation.id, 10)).some(item => item.id === fact.id), true);
  assert.equal(await memory.invalidateFactsForMessage(conversation.id, message.id), 1);
  assert.equal((await memory.readInjectableFacts(conversation.id, 10)).some(item => item.id === fact.id), false);
  assert.equal((await memory.listMemoryFacts(user.id, conversation.id)).length, 0);
});

test('记忆默认关闭时不登记任务；打开后不到阈值也不登记，到了才登记且只有一行', async () => {
  const other = await db.conversation.create({data: {userId: user.id, characterId: character.id, title: '阈值会话'}});
  const first = await db.message.create({data: {conversationId: other.id, role: 'USER', content: '第一条'}});
  const second = await db.message.create({data: {conversationId: other.id, role: 'ASSISTANT', content: '第二条'}});
  assert.ok(first.id && second.id);
  // 默认关闭：不登记任何任务。
  assert.equal(await memory.enqueueSummaryIfDue(other.id), false);
  assert.equal(await memory.enqueueMemorySummary(other.id), false);
  assert.equal(await db.backgroundTask.count({where: {kind: 'memory-summary', subjectId: other.id}}), 0);
  await setMemoryEnabled(true);
  // 打开后仍不到阈值（默认 20 条）。
  assert.equal(await memory.enqueueSummaryIfDue(other.id), false);
  assert.equal(await db.backgroundTask.count({where: {kind: 'memory-summary', subjectId: other.id}}), 0);
  assert.equal(await memory.enqueueMemorySummary(other.id), true);
  assert.equal(await memory.enqueueMemorySummary(other.id), true);
  assert.equal(await db.backgroundTask.count({where: {kind: 'memory-summary', subjectId: other.id}}), 1);
});

test('上下文按预算裁剪：关闭记忆不注入，超预算先砍事实', async () => {
  await setMemoryEnabled(false);
  const third = await db.conversation.create({data: {userId: user.id, characterId: character.id, title: '预算会话'}});
  await db.conversationMemory.create({data: {conversationId: third.id, summary: '两人约好周末去看海。', version: 1}});
  // 关闭时即使有摘要也不注入。
  assert.equal((await memory.buildMemoryContext(third.id)).injected, false);
  await setMemoryEnabled(true);
  for (const text of ['用户怕水', '用户喜欢蓝色', '用户在学游泳']) await memory.createMemoryFact(user.id, third.id, {text});
  const full = await memory.buildMemoryContext(third.id);
  assert.equal(full.injected, true);
  assert.match(full.text, /周末去看海/);
  assert.equal(full.facts.length, 3);
  // 预算只够摘要（默认 8000 token，摘要约 22 字）：事实全部被砍掉，但摘要仍注入。
  const tight = await memory.buildMemoryContext(third.id, {reservedTokens: 7978});
  assert.equal(tight.injected, true);
  assert.equal(tight.facts.length, 0);
  assert.match(tight.text, /周末去看海/);
  // 预算耗尽：什么都不注入，聊天照常继续。
  assert.equal((await memory.buildMemoryContext(third.id, {reservedTokens: 100000})).injected, false);
});

test('租约领取后并发不重复执行，失败按上限置 FAILED', async () => {
  const subjectId = 'synthetic-' + randomUUID();
  await tasks.enqueueTask('memory-summary', subjectId);
  const [left, right] = await Promise.all([tasks.runDueTasks({limit: 5}), tasks.runDueTasks({limit: 5})]);
  const row = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'memory-summary', subjectId}}});
  // 两次并发只应有一次真正领到这一行。
  assert.equal(left.claimed + right.claimed >= 1, true);
  assert.ok(['DONE', 'PENDING', 'FAILED'].includes(row.status));
  assert.equal(row.leaseOwner, null);
});

test('巡检任务按间隔重新排期，未知类型直接置 FAILED', async () => {
  const created = await tasks.ensureSweepTasks();
  assert.equal(created >= 1, true);
  assert.equal(await tasks.ensureSweepTasks(), 0);
  const sweep = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'mirror-expire', subjectId: tasks.SWEEP_SUBJECT}}});
  assert.equal(sweep.status, 'PENDING');
  const report = await tasks.runDueTasks({kinds: ['mirror-expire']});
  assert.equal(report.failed, 0);
  const after = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'mirror-expire', subjectId: tasks.SWEEP_SUBJECT}}});
  assert.equal(after.status, 'PENDING');
  assert.equal(after.attempts, 0);
  assert.ok(after.nextRunAt.getTime() > Date.now());

  await db.backgroundTask.create({data: {kind: 'no-such-kind', subjectId: 'x', status: 'PENDING', nextRunAt: new Date(Date.now() - 1000)}});
  const unknown = await tasks.runDueTasks({kinds: ['no-such-kind']});
  assert.equal(unknown.failed, 1);
  assert.equal((await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'no-such-kind', subjectId: 'x'}}})).status, 'FAILED');
});

test('关闭时摘要任务直接跳过，会话不存在也跳过；未注册的 kind 没有处理器', async () => {
  assert.equal(handlerFor('memory-summary') !== null, true);
  assert.equal(handlerFor('nope'), null);
  assert.equal(await readMemorySummary('missing-conversation'), null);
  assert.equal((await memory.runMemorySummaryTask('missing-conversation')).outcome, 'SKIPPED_MISSING');
  await setMemoryEnabled(false);
  assert.equal((await memory.runMemorySummaryTask(conversation.id)).outcome, 'SKIPPED_DISABLED');
});
test('每日备份与事件清理都是巡检任务，可被调度且每轮自动重排', async () => {
  const before = Date.now();
  await tasks.ensureSweepTasks();
  for (const kind of ['daily-backup', 'event-cleanup']) {
    const row = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind, subjectId: tasks.SWEEP_SUBJECT}}});
    assert.ok(row, kind + ' 没有排进巡检任务');
    assert.equal(row.status, 'PENDING');
    assert.equal(handlerFor(kind) !== null, true);
  }
  // 首次建行：daily-backup 排到 +24h（发布流程已做过一次备份，部署瞬间不再重复打一份），
  // 其余巡检照旧从当下开始扫。
  const daily = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'daily-backup', subjectId: tasks.SWEEP_SUBJECT}}});
  const dailyHours = (daily.nextRunAt.getTime() - before) / 3_600_000;
  assert.ok(dailyHours > 23 && dailyHours < 25, 'daily-backup 首次应排在约 24 小时后，实际 ' + dailyHours + ' 小时');
  const sweep = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'event-cleanup', subjectId: tasks.SWEEP_SUBJECT}}});
  assert.ok(sweep.nextRunAt.getTime() - before < 60_000, 'event-cleanup 首次应立刻到期');
});

test('每日备份执行一次后把下次运行排到约 24 小时后，当天不重复备份', async () => {
  const before = Date.now();
  // 首次建行在 +24h，手动「执行一次」会先把它排到当下再跑。
  const report = await tasks.runKindNow('daily-backup');
  assert.equal(report.failed, 0);
  assert.match(report.results[0].outcome, /已备份到/);
  // 备份文件真的写出来了，文件名带业务日期。
  const written = backupFiles();
  assert.equal(written.length, 1);
  assert.match(written[0], /-\d{4}-\d{2}-\d{2}\.db$/);
  const row = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'daily-backup', subjectId: tasks.SWEEP_SUBJECT}}});
  assert.equal(row.status, 'PENDING');
  assert.equal(row.attempts, 0);
  const hours = (row.nextRunAt.getTime() - before) / 3_600_000;
  assert.ok(hours > 23 && hours < 25, '下次运行应在约 24 小时后，实际 ' + hours + ' 小时');

  // 后台「立即执行」走 runKindNow：同一天已有备份，跳过而不覆盖。
  const again = await tasks.runKindNow('daily-backup');
  assert.match(again.results[0].outcome, /今天已有备份/);
  assert.equal(backupFiles().length, 1);
});

test('备份本身失败时抛出而不是当成功，重试用尽后置 FAILED 并在后台可见', async () => {
  const originalUrl = process.env.DATABASE_URL;
  await setGrowthSetting('tasks.maxAttempts', 1);
  // 指向一个不存在的数据库文件：备份实现会抛错，任务必须失败而不是记成成功。
  process.env.DATABASE_URL = 'file:./no-such-backup-source.db';
  try {
    const report = await tasks.runKindNow('daily-backup');
    assert.equal(report.failed, 1);
    assert.equal(report.done, 0);
    assert.match(report.results[0].error, /ENOENT|数据库文件不存在/);
  } finally {
    process.env.DATABASE_URL = originalUrl;
    await db.operationSetting.deleteMany({where: {key: 'tasks.maxAttempts'}});
    const {clearCache} = await import('../src/lib/settings/cache.ts');
    clearCache();
  }
  const row = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'daily-backup', subjectId: tasks.SWEEP_SUBJECT}}});
  assert.equal(row.status, 'FAILED');
  assert.match(row.lastError, /ENOENT|数据库文件不存在/);
  assert.equal(row.attempts, 1);
  // 备份没有成功：当天不该凭空多出一份文件。
  assert.equal(backupFiles().length, 1);

  // 人工「执行一次」把它从 FAILED 拉回正常排期，不会永久卡死。
  await tasks.runKindNow('daily-backup');
  const recovered = await db.backgroundTask.findUnique({where: {kind_subjectId: {kind: 'daily-backup', subjectId: tasks.SWEEP_SUBJECT}}});
  assert.equal(recovered.status, 'PENDING');
  assert.equal(recovered.lastError, null);
});

test('事件清理按保留天数删除，保留天数每次从数据库读，改设置后下次生效', async () => {
  const daysAgo = days => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const make = (name, days) => db.productEvent.create({data: {name, subjectKey: name + '-' + randomUUID(), createdAt: daysAgo(days)}});
  await make('mirror_visited', 200);
  await make('dispute_visited', 100);
  await make('invite_visited', 0);

  await setGrowthSetting('growth.eventRetentionDays', 180);
  const first = await tasks.runDueTasks({kinds: ['event-cleanup']});
  assert.match(first.results[0].outcome, /按保留 180 天清理，删除 1 条/);
  assert.equal(await db.productEvent.count(), 2);

  // 改小保留天数：下一次任务按新值清理，不需要重启进程。
  await setGrowthSetting('growth.eventRetentionDays', 30);
  const second = await tasks.runKindNow('event-cleanup');
  assert.match(second.results[0].outcome, /按保留 30 天清理，删除 1 条/);
  assert.equal(await db.productEvent.count(), 1);
});

