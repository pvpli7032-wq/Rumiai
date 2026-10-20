// W08 评测框架 · domain 执行器。
// 不依赖模型的领域规则断言：权限隔离、幂等与 409 语义、回合编排（M3-3 turn-service）、
// DTO 白名单、旧路径不得绕过状态机。直接调用 src/lib/stories 服务层（M3-3 真实行为），
// 数据落在一次性隔离 SQLite 上。
//
// 结构：按用例 id 分派到独立剧本函数；status=implemented 但没有剧本的用例记 FAIL
// （执行器已注册却不能执行属于框架缺陷，不许静默放行）。业务源只读；需要 mock 的
// 场景（如 UNKNOWN/GENERATING 回合）直接用 db 造持久化状态，不改业务代码。

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStoryFixture, storyEvaluationEnvironment, storyRejection, runTurn, turnRequestHash} from './harness.mjs';

// ---------------------------------------------------------------- 剧本函数

/** EV-A01-001 新开故事创建独立实例与专属会话，旧自由聊天互不混入。 */
async function a01_001({db, modules}) {
  const f = await createStoryFixture(db, 'a01-001');
  const free = await modules.conversations.createOrReuseConversation(f.owner.id, {characterId: f.character.id});
  const {run, created} = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  assert.equal(created, true);
  assert.notEqual(run.conversationId, free.conversation.id, '故事会话不得复用旧自由聊天会话');
  const again = await modules.conversations.createOrReuseConversation(f.owner.id, {characterId: f.character.id});
  assert.equal(again.conversation.id, free.conversation.id, '旧聊天仍指向原会话');
  assert.equal(await db.message.count({where: {conversationId: free.conversation.id}}), 0);
  return {result: 'PASS', reason: '独立实例+专属会话创建成功，旧自由聊天会话互不混入'};
}

/** EV-A01-002 继续故事定位原会话并展示最近真实消息。 */
async function a01_002({db, modules}) {
  const f = await createStoryFixture(db, 'a01-002');
  const first = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  await runTurn(modules.turn, f.owner.id, first.run, '第一条消息', randomUUID(), 0);
  const second = await modules.runService.readStoryRun(f.owner.id, first.run.id);
  const secondTurn = await runTurn(modules.turn, f.owner.id, second.run, '第二条消息', randomUUID(), second.run.revision);
  assert.equal(secondTurn.at(-1).type, 'done');
  const view = await modules.runService.readStoryRun(f.owner.id, first.run.id);
  const messages = await db.message.findMany({where: {conversationId: first.run.conversationId}, orderBy: {id: 'asc'}});
  assert.deepEqual(messages.map(m => `${m.role}`), ['USER', 'ASSISTANT', 'USER', 'ASSISTANT'], '两轮消息都持久化在原会话');
  assert.equal(view.run.conversationId, first.run.conversationId, '继续进入同一实例与会话');
  assert.equal(view.run.lastCommittedTurnNo, 2);
  const lastTurn = view.run.turns.at(-1);
  assert.equal(lastTurn.assistantMessageId, messages[3].id, '详情视图的最近回合关联最近真实消息');
  return {result: 'PASS', reason: '两轮回合均定位原会话，消息按回合序持久化且详情视图可读出最近消息'};
}

/** EV-A02-001 同一 requestId 的回合重试返回相同回合，不重复生成结算。 */
async function a02_001({db, modules}) {
  const f = await createStoryFixture(db, 'a02-001');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const requestId = randomUUID();
  const events = await runTurn(modules.turn, f.owner.id, created.run, '幂等内容', requestId, 0);
  assert.equal(events.at(-1).type, 'done');
  const replay = await runTurn(modules.turn, f.owner.id, created.run, '幂等内容', requestId, 1);
  assert.deepEqual(replay.map(e => e.type), ['committed', 'state_pending', 'done'], '重放不重新生成（无 accepted/delta）');
  assert.equal(replay[0].turnId, events[0].turnId, '重放返回同一 turnId');
  assert.equal(await db.storyTurn.count({where: {runId: created.run.id}}), 1);
  assert.equal(await db.message.count({where: {conversationId: created.run.conversationId}}), 2);
  assert.equal(await db.aiCall.count({where: {userId: f.owner.id}}), 1, '外部调用恰好结算一次');
  return {result: 'PASS', reason: '同键重放返回 committed 事件与同一 turnId，无二次生成与结算'};
}

/** EV-A02-002 多标签页并发写入携带 expectedRevision，冲突返回 409。 */
async function a02_002({db, modules}) {
  const f = await createStoryFixture(db, 'a02-002');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  await runTurn(modules.turn, f.owner.id, created.run, '占住进度', randomUUID(), 0);
  const stale = await storyRejection(runTurn(modules.turn, f.owner.id, created.run, '旧标签页写入', randomUUID(), 0), '旧 revision');
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'REVISION_CONFLICT');
  assert.equal(stale.data.currentRevision, 2, '冲突响应带当前 revision 供刷新');
  assert.ok(stale.data.run, '契约要求冲突返回当前公开 run 视图');
  const fresh = await runTurn(modules.turn, f.owner.id, created.run, '新标签页写入', randomUUID(), 2);
  assert.equal(fresh.at(-1).type, 'done', '当前 revision 写入成功');
  assert.equal(await db.message.count({where: {conversationId: created.run.conversationId}}), 4, '被拒写入未产生消息');
  return {result: 'PASS', reason: '旧 expectedRevision 得 409+当前视图，当前 revision 写入成功且互不覆盖'};
}

/** EV-A02-003 并发创建同 requestId 实例端到端幂等。 */
async function a02_003({db, modules}) {
  const f = await createStoryFixture(db, 'a02-003');
  const attempts = await Promise.allSettled([
    modules.runService.createStoryRun(f.owner.id, f.createInput),
    modules.runService.createStoryRun(f.owner.id, f.createInput),
  ]);
  assert.ok(attempts.some(r => r.status === 'fulfilled'), '至少一次创建成功');
  for (const r of attempts) {
    if (r.status === 'rejected') assert.ok(['P1008', 'P2028', 'P2034'].includes(r.reason.code), `并发输家只能是连接类错误，实际 ${r.reason.code}`);
  }
  const replay = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  assert.equal(replay.created, false);
  assert.equal(await db.storyRun.count({where: {userId: f.owner.id}}), 1);
  assert.equal(await db.conversation.count({where: {userId: f.owner.id}}), 1);
  assert.equal((await db.character.findUnique({where: {id: f.character.id}})).chatCount, 1, '计数不因重试增加');
  return {result: 'PASS', reason: '并发创建只落一个实例/会话，重试为幂等回放，chatCount 恰加一次'};
}

/** EV-A02-004 结果不明先核对本地记录，不自动重发有成本的生成。 */
async function a02_004({db, modules}) {
  const f = await createStoryFixture(db, 'a02-004');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const content = '结果不明的回合';
  await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'unknown-key', requestHash: turnRequestHash(content), operation: 'SEND', status: 'UNKNOWN', startedAt: new Date()}});
  const events = await runTurn(modules.turn, f.owner.id, created.run, content, 'unknown-key', 0);
  assert.deepEqual(events.map(e => e.type), ['error', 'done'], '重试不重新生成，直接给出核对结果');
  assert.equal(events[0].code, 'TURN_UNKNOWN', 'UNKNOWN 回合被显式呈现而非静默重建');
  const turn = await db.storyTurn.findFirstOrThrow({where: {runId: created.run.id}});
  assert.equal(turn.status, 'UNKNOWN', '回合状态不被重试改写');
  assert.equal(await db.aiCall.count({where: {userId: f.owner.id}}), 0, '未新增外部模型调用');
  assert.equal(await db.message.count({where: {conversationId: created.run.conversationId}}), 0);
  return {result: 'PASS', reason: '同键重试得到 TURN_UNKNOWN 错误事件，无新回合、新消息与外部调用'};
}

/** EV-A03-002 刷新或断线重进先查询回合状态，不盲目重发。 */
async function a03_002({db, modules}) {
  const f = await createStoryFixture(db, 'a03-002');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'in-flight', requestHash: turnRequestHash('仍在生成'), operation: 'SEND', status: 'GENERATING', startedAt: new Date()}});
  const rejected = await storyRejection(runTurn(modules.turn, f.owner.id, created.run, '仍在生成', 'in-flight', 0), '进行中重试');
  assert.equal(rejected.status, 409);
  assert.equal(rejected.code, 'TURN_IN_PROGRESS', '同键命中进行中回合，要求先查询而非重发');
  assert.equal(await db.storyTurn.count({where: {runId: created.run.id}}), 1);
  assert.equal(await db.aiCall.count({where: {userId: f.owner.id}}), 0);
  return {result: 'PASS', reason: '进行中回合重试得 409 TURN_IN_PROGRESS，服务端拒绝盲目重发（GET turns 查询端点属浏览器层口径）'};
}

/** EV-A04-001 猜测 run 标识读不到他人私密内容。 */
async function a04_001({db, modules}) {
  const f = await createStoryFixture(db, 'a04-001');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const foreign = await storyRejection(modules.runService.readStoryRun(f.stranger.id, created.run.id), 'stranger 读他人 run');
  assert.equal(foreign.status, 404, '越权访问按不存在处理，不泄露存在性');
  const guessed = await storyRejection(modules.runService.readStoryRun(f.stranger.id, randomUUID()), '猜测 id');
  assert.equal(guessed.status, 404);
  assert.deepEqual((await modules.runService.listStoryRuns(f.stranger.id)).items, []);
  return {result: 'PASS', reason: '他人与猜测的 run 标识均得 404，列表不含他人实例'};
}

/** EV-A04-003 DTO 白名单：隐藏剧情、提示词、stateJson、lease 不输出。 */
async function a04_003({db, modules}) {
  const f = await createStoryFixture(db, 'a04-003');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const message = await db.message.create({data: {conversationId: created.run.conversationId, role: 'ASSISTANT', content: 'PRIVATE_MESSAGE'}});
  const turn = await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'dto', requestHash: turnRequestHash('x'), operation: 'SEND', status: 'COMMITTED', stateStatus: 'PROCESSED', startedAt: new Date(), committedAt: new Date(), assistantMessageId: message.id, leaseOwner: 'PRIVATE_LEASE'}});
  await db.storyEvent.create({data: {runId: created.run.id, sourceTurnId: turn.id, chapterKey: 'opening', type: 'FACT', status: 'CONFIRMED', sourceMessageId: message.id, payloadJson: JSON.stringify({schemaVersion: 1, publicSummary: '公开事实', hidden: 'PRIVATE_EVENT'})}});
  const serialized = JSON.stringify(await modules.runService.readStoryRun(f.owner.id, created.run.id));
  for (const secret of ['SECRET_PLOT', 'PRIVATE_PERSONA', 'PRIVATE_PROMPT', 'PRIVATE_MESSAGE', 'PRIVATE_EVENT', 'PRIVATE_LEASE', 'stateJson', 'leaseOwner', 'createRequestId']) {
    assert.equal(serialized.includes(secret), false, `DTO 不得输出 ${secret}`);
  }
  assert.ok(serialized.includes('公开事实'), '确认事件的公开摘要正常输出');
  return {result: 'PASS', reason: '公开视图不含隐藏剧情/提示词/stateJson/租约/请求键，事件只出公开摘要'};
}

/**
 * 三轮 mock 回合 + 手工派生数据（确认事件与检查点）的公共夹具。
 * mock 回合只落消息与 turn 行（状态提取是 M4 worker 职责），
 * 派生事件/检查点按 m3-data-contract 的持久化口径直接写入，供失效断言使用。
 */
async function threeTurnRunWithDerivatives(db, modules, tag) {
  const f = await createStoryFixture(db, tag);
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  let revision = 0;
  const committed = [];
  for (let i = 1; i <= 3; i++) {
    const events = await runTurn(modules.turn, f.owner.id, created.run, `第 ${i} 轮`, randomUUID(), revision);
    const receipt = events.find(e => e.type === 'committed');
    revision = receipt.revision;
    committed.push(receipt);
    // mock 回合两条消息可能落在同一毫秒，而历史级联按 createdAt 严格比较
    // （规划书第 16 章记录的旧语义边界）。评测夹具显式拉开时间，保证断言确定性。
    const base = Date.UTC(2026, 0, 1, 0, i, 0);
    await db.message.update({where: {id: receipt.userMessageId}, data: {createdAt: new Date(base)}});
    await db.message.update({where: {id: receipt.assistantMessageId}, data: {createdAt: new Date(base + 1000)}});
  }
  const turns = await db.storyTurn.findMany({where: {runId: created.run.id}, orderBy: {turnNo: 'asc'}});
  const base = {runId: created.run.id, chapterKey: 'opening', type: 'FACT'};
  for (const turn of turns) {
    const messageId = turn.assistantMessageId;
    await db.storyEvent.create({data: {...base, sourceTurnId: turn.id, status: 'CONFIRMED', sourceMessageId: messageId, payloadJson: JSON.stringify({schemaVersion: 1, publicSummary: `第 ${turn.turnNo} 轮事实`})}});
  }
  await db.storyCheckpoint.create({data: {runId: created.run.id, throughTurnNo: 2, revision, stateJson: JSON.stringify({schemaVersion: 1, chapterKey: 'opening', facts: ['第 1 轮事实', '第 2 轮事实']})}});
  return {f, run: created.run, turns, revision};
}

/** EV-A06-001 编辑第 N 回合使 N 及之后的派生事件与快照在同一事务失效。 */
async function a06_001({db, modules}) {
  const {f, run, turns, revision} = await threeTurnRunWithDerivatives(db, modules, 'a06-001');
  const turn2UserMessageId = turns[1].inputMessageId;
  const result = await modules.messages.editUserMessage(f.owner.id, run.conversationId, turn2UserMessageId, {content: '修正后的第二轮'});
  assert.equal(result.message.content, '修正后的第二轮', '编辑生效');
  assert.equal(result.droppedReplies, 3, '第 2 轮回复与第 3 轮两条消息同事务删除');
  const events = await db.storyEvent.findMany({where: {runId: run.id}, orderBy: {sourceTurnId: 'asc'}});
  const byTurn = new Map();
  for (let i = 0; i < events.length; i++) byTurn.set(turns[i].id, events[i]);
  assert.equal(byTurn.get(turns[0].id).status, 'CONFIRMED', '第 1 轮事件不受影响');
  assert.ok(byTurn.get(turns[1].id).status === 'INVALIDATED' && byTurn.get(turns[1].id).invalidatedAt, '第 2 轮事件失效');
  assert.ok(byTurn.get(turns[2].id).status === 'INVALIDATED' && byTurn.get(turns[2].id).invalidatedAt, '第 3 轮事件失效');
  const checkpoints = await db.storyCheckpoint.findMany({where: {runId: run.id}});
  const initial = checkpoints.find(c => c.throughTurnNo === 0);
  const mid = checkpoints.find(c => c.throughTurnNo === 2);
  assert.equal(initial.invalidatedAt, null, '初始检查点保留');
  assert.ok(mid.invalidatedAt, 'throughTurnNo>=2 的快照失效');
  const invalidatedTurns = await db.storyTurn.findMany({where: {runId: run.id, stateStatus: 'INVALIDATED'}});
  assert.deepEqual(invalidatedTurns.map(t => t.turnNo).sort(), [2, 3], '第 2/3 轮提取状态标记 INVALIDATED');
  const runRow = await db.storyRun.findUniqueOrThrow({where: {id: run.id}});
  assert.equal(runRow.revision, revision + 1, '失效事务恰好提升一次 revision');
  assert.equal(runRow.lastCommittedTurnNo, 1, '提交游标回滚到第 1 轮');
  assert.equal(runRow.stateProcessedThroughTurnNo, 0, '状态游标回滚，失效摘要不会被当作已处理');
  assert.deepEqual(JSON.parse(runRow.stateJson), {schemaVersion: 1, chapterKey: 'opening'}, '状态从最近有效检查点（初始）重建，旧摘要不再存在');
  assert.equal(await db.message.count({where: {conversationId: run.conversationId}}), 3, '保留第 1 轮两条消息与改后的第 2 轮用户消息');
  return {result: 'PASS', reason: '编辑第 2 轮同事务失效 N 及之后事件/快照/提取状态，游标回滚、状态重建、revision 恰加一'};
}

/** EV-A06-002 删除消息同事务失效并提升 revision。 */
async function a06_002({db, modules}) {
  const {f, run, turns, revision} = await threeTurnRunWithDerivatives(db, modules, 'a06-002');
  const turn2UserMessageId = turns[1].inputMessageId;
  const result = await modules.messages.deleteMessageAndFollowing(f.owner.id, run.conversationId, turn2UserMessageId);
  assert.equal(result.success, true);
  assert.equal(await db.message.count({where: {conversationId: run.conversationId}}), 2, '第 2 轮及之后消息全部删除');
  const invalidated = await db.storyEvent.count({where: {runId: run.id, status: 'INVALIDATED', sourceTurn: {turnNo: {gte: 2}}}});
  assert.equal(invalidated, 2, '第 2/3 轮确认事件同事务失效');
  assert.equal(await db.storyEvent.count({where: {runId: run.id, status: 'CONFIRMED'}}), 1, '第 1 轮事件保留');
  const runRow = await db.storyRun.findUniqueOrThrow({where: {id: run.id}});
  assert.equal(runRow.revision, revision + 1, '删除事务提升 revision');
  assert.equal(runRow.lastCommittedTurnNo, 1);
  assert.deepEqual(JSON.parse(runRow.stateJson), {schemaVersion: 1, chapterKey: 'opening'}, '状态从最近有效检查点重建');
  return {result: 'PASS', reason: '删除同事务失效派生事件并提升 revision，状态重建自最近有效检查点'};
}

/** EV-A06-005 故事会话中旧发送/重生成不得绕过状态机；历史修改走同事务失效，不绕过。 */
async function a06_005({db, modules}) {
  const f = await createStoryFixture(db, 'a06-005');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const signal = new AbortController().signal;
  for (const mode of ['SEND', 'REGENERATE']) {
    const rejected = await storyRejection(modules.chatApp.executeChatTurn({userId: f.owner.id, conversationId: created.run.conversationId, mode, input: mode === 'SEND' ? {request: new Request('http://story-eval.invalid', {method: 'POST', body: JSON.stringify({content: '绕过'})})} : {targetMessageId: 'missing'}, signal}), `chat ${mode}`);
    assert.equal(rejected.status, 409, `旧聊天 ${mode} 不得写故事会话`);
  }
  assert.equal(await db.message.count({where: {conversationId: created.run.conversationId}}), 0, '旧路径未写入任何消息');
  // 编辑/删除不得绕过状态机：走 m3-data-contract §7 的同事务失效，而非静默改历史。
  const {f: f2, run: run2, turns: turns2, revision} = await threeTurnRunWithDerivatives(db, modules, 'a06-005-b');
  const edited = await modules.messages.editUserMessage(f2.owner.id, run2.conversationId, turns2[0].inputMessageId, {content: '纠错'});
  assert.equal(edited.message.content, '纠错', '编辑生效');
  assert.equal(edited.droppedReplies, 5, '后续消息同事务删除');
  const runAfter = await db.storyRun.findUniqueOrThrow({where: {id: run2.id}});
  assert.equal(runAfter.revision, revision + 1, '编辑走失效事务并提升 revision，不是静默改历史');
  assert.ok(await db.storyEvent.count({where: {runId: run2.id, status: 'INVALIDATED'}}) > 0, '派生事件同事务失效');
  return {result: 'PASS', reason: '旧 SEND/REGENERATE 一律 409；编辑/删除经同事务失效处理，状态机无旁路'};
}

/** EV-A06-006 回合序号定义因果先后，不依赖 createdAt 时间字符串。 */
async function a06_006({db, modules}) {
  const f = await createStoryFixture(db, 'a06-006');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  let revision = 0;
  for (let i = 1; i <= 3; i++) {
    const events = await runTurn(modules.turn, f.owner.id, created.run, `第 ${i} 轮`, randomUUID(), revision);
    assert.equal(events.at(-1).type, 'done');
    revision = events.find(e => e.type === 'committed').revision;
  }
  const turns = await db.storyTurn.findMany({where: {runId: created.run.id}, orderBy: {turnNo: 'asc'}});
  assert.deepEqual(turns.map(t => t.turnNo), [1, 2, 3], '回合序号单调递增');
  const run = await db.storyRun.findUniqueOrThrow({where: {id: created.run.id}});
  assert.equal(run.lastCommittedTurnNo, 3, '游标按回合序号推进');
  // 人为打乱 createdAt 也不改变因果顺序：详情视图按 turnNo 排序。
  await db.message.update({where: {id: turns[0].inputMessageId}, data: {createdAt: new Date(Date.now() + 60_000)}});
  const view = await modules.runService.readStoryRun(f.owner.id, created.run.id);
  assert.deepEqual(view.run.turns.map(t => t.turnNo), [1, 2, 3], '排序只依据 turnNo，不依赖 createdAt');
  return {result: 'PASS', reason: '回合因果由 turnNo/lastCommittedTurnNo 定义，消息时间戳不参与排序'};
}

/** EV-A12-002 普通回合仅轻量规则检查，不每条消息触发多个模型调用。 */
async function a12_002({db, modules}) {
  const f = await createStoryFixture(db, 'a12-002');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const events = await runTurn(modules.turn, f.owner.id, created.run, '普通一回合', randomUUID(), 0);
  assert.equal(events.at(-1).type, 'done');
  const calls = await db.aiCall.findMany({where: {userId: f.owner.id}});
  assert.equal(calls.length, 1, '一回合恰好一次调用记录');
  assert.equal(calls[0].operation, 'SEND', '只有聊天主调用，无辅助模型调用');
  assert.equal(await db.storyTurn.count({where: {runId: created.run.id}}), 1);
  return {result: 'PASS', reason: '普通回合只产生一条 SEND 调用记录，未触发任何辅助模型调用'};
}

/** EV-A01-006 重新开始创建新实例，旧进度保留。 */
async function a01_006({db, modules}) {
  const f = await createStoryFixture(db, 'a01-006');
  const first = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const events = await runTurn(modules.turn, f.owner.id, first.run, '旧进度', randomUUID(), 0);
  assert.equal(events.at(-1).type, 'done');
  const restarted = await modules.runService.createStoryRun(f.owner.id, {...f.createInput, requestId: randomUUID()});
  assert.equal(restarted.created, true, '重新开始创建新实例');
  assert.notEqual(restarted.run.id, first.run.id);
  assert.notEqual(restarted.run.conversationId, first.run.conversationId);
  assert.equal(restarted.run.chapter.key, 'opening', '新实例从初始章开始');
  const old = await modules.runService.readStoryRun(f.owner.id, first.run.id);
  assert.equal(old.run.revision, 2, '旧实例 revision 不受新开影响');
  assert.equal(old.run.lastCommittedTurnNo, 1, '旧进度完整保留');
  assert.equal(await db.message.count({where: {conversationId: first.run.conversationId}}), 2);
  assert.equal((await db.character.findUnique({where: {id: f.character.id}})).chatCount, 2, '两次开始各计一次');
  return {result: 'PASS', reason: '重新开始得到全新实例与会话，旧实例的回合、消息与游标原样保留'};
}

async function w07Services() {
  return Promise.all([import('../../../src/lib/conversations/privacy.ts'), import('../../../src/lib/stories/lifecycle/share-service.ts'), import('../../../src/lib/stories/lifecycle/state-worker.ts'), import('../../../src/lib/stories/lifecycle/export-service.ts'), import('../../../src/lib/stories/lifecycle/chapter-service.ts')]);
}

async function a04_002({db, modules}) {
  const f = await createStoryFixture(db, 'a04-002');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const turn = await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'private-event', requestHash: turnRequestHash('x'), operation: 'SEND', status: 'COMMITTED', stateStatus: 'PROCESSED', startedAt: new Date(), committedAt: new Date()}});
  await db.storyEvent.create({data: {runId: created.run.id, sourceTurnId: turn.id, chapterKey: 'opening', type: 'FACT', status: 'CONFIRMED', payloadJson: JSON.stringify({schemaVersion: 1, publicSummary: 'owner-only event'})}});
  const stranger = await storyRejection(modules.runService.readStoryRun(f.stranger.id, created.run.id), 'stranger event access');
  assert.equal(stranger.status, 404);
  assert.deepEqual((await modules.runService.listStoryRuns(f.stranger.id)).items, []);
  return {result: 'PASS', reason: '事件只通过所有者 run view 读取；他人 run 详情 404 且列表为空'};
}

async function a04_004({db, modules}) {
  const [, shareModule] = await w07Services();
  const f = await createStoryFixture(db, 'a04-004');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const events = await runTurn(modules.turn, f.owner.id, created.run, '仅选中的公开片段', randomUUID(), 0);
  const receipt = events.find(e => e.type === 'committed');
  const selection = [receipt.userMessageId, receipt.assistantMessageId];
  const {share} = await shareModule.createStoryShare(f.owner.id, created.run.id, {title: '公开标题', messageIds: selection});
  const snapshot = JSON.stringify(share.snapshot);
  assert.deepEqual(Object.keys(share.snapshot).sort(), ['chapterTitle', 'fragments', 'publicSummary', 'schemaVersion', 'templateTitle'].sort());
  assert.equal(share.snapshot.fragments.length, 2);
  assert.ok(snapshot.includes('仅选中的公开片段'));
  for (const secret of ['SECRET_PLOT', 'PRIVATE_PERSONA', 'PRIVATE_PROMPT', 'identity', 'notes', 'stateJson']) assert.equal(snapshot.includes(secret), false, secret);
  return {result: 'PASS', reason: '分享快照只含公开模板/章节文案与用户选中的两条消息，不含私密身份或状态字段'};
}

async function a06_003({db, modules}) {
  const {f, run, turns} = await threeTurnRunWithDerivatives(db, modules, 'a06-003');
  await modules.messages.editUserMessage(f.owner.id, run.conversationId, turns[1].inputMessageId, {content: '修正 checkpoint 前事实'});
  const after = await db.storyRun.findUniqueOrThrow({where: {id: run.id}});
  const events = await db.storyEvent.findMany({where: {runId: run.id, status: 'CONFIRMED'}});
  assert.deepEqual(JSON.parse(after.stateJson), {schemaVersion: 1, chapterKey: 'opening'});
  assert.equal(events.length, 1);
  assert.equal(events[0].payloadJson.includes('第 2 轮事实'), false);
  assert.equal(after.stateProcessedThroughTurnNo, 0);
  return {result: 'PASS', reason: '编辑第 N 轮后状态按最近未失效检查点重建；旧确认摘要已失效且游标回退'};
}

async function a07_002({db, modules}) {
  const [, , worker] = await w07Services();
  const f = await createStoryFixture(db, 'a07-002');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const turn = await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'recovery-idempotency', requestHash: turnRequestHash('saved'), operation: 'SEND', status: 'COMMITTED', stateStatus: 'PENDING', startedAt: new Date(), committedAt: new Date()}});
  const userMessage = await db.message.create({data: {conversationId: created.run.conversationId, role: 'USER', content: 'saved'}});
  const assistant = await db.message.create({data: {conversationId: created.run.conversationId, role: 'ASSISTANT', content: 'saved reply'}});
  await db.storyTurn.update({where: {id: turn.id}, data: {inputMessageId: userMessage.id, assistantMessageId: assistant.id}});
  await db.storyRun.update({where: {id: created.run.id}, data: {lastCommittedTurnNo: 1, revision: 2}});
  assert.equal((await worker.processPendingStateWork()).processed, 1);
  const afterFirst = await db.storyRun.findUniqueOrThrow({where: {id: created.run.id}});
  assert.equal((await worker.processPendingStateWork()).processed, 0);
  const afterSecond = await db.storyRun.findUniqueOrThrow({where: {id: created.run.id}});
  assert.equal(await db.storyEvent.count({where: {runId: created.run.id}}), 1);
  assert.equal(await db.storyCheckpoint.count({where: {runId: created.run.id, throughTurnNo: 1}}), 1);
  assert.equal(afterFirst.stateProcessedThroughTurnNo, 1);
  assert.equal(afterSecond.stateProcessedThroughTurnNo, 1);
  assert.equal(afterSecond.revision, afterFirst.revision);
  return {result: 'PASS', reason: '同一已处理任务再次扫描不重复创建事件/检查点或推进 revision'};
}

async function a08_001({db, modules}) {
  const f = await createStoryFixture(db, 'a08-001');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const oldVersion = created.run.templateVersionId;
  const newer = await db.storyTemplateVersion.create({data: {templateId: f.template.id, version: 2, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify({...f.definition, publicSummary: '新版本摘要', hiddenFacts: 'NEW_SECRET'}), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: f.character.id, prompt: 'NEW_PROMPT'})}});
  assert.notEqual(newer.id, oldVersion);
  const current = await modules.runService.readStoryRun(f.owner.id, created.run.id);
  assert.equal(current.run.template.version, 1, 'existing run remains bound to its original version');
  assert.equal(current.run.template.publicSummary, '公开介绍');
  assert.equal(JSON.stringify(current).includes('新版本摘要'), false);
  return {result: 'PASS', reason: '发布新模板版本不改在途 run 的 versionId、版本号或公开摘要'};
}

async function a08_002({db, modules}) {
  const f = await createStoryFixture(db, 'a08-002');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  await db.storyTemplate.update({where: {id: f.template.id}, data: {status: 'DRAFT'}});
  const rejection = await storyRejection(modules.runService.createStoryRun(f.owner.id, {...f.createInput, requestId: randomUUID()}), 'new run from draft');
  assert.equal(rejection.status, 404);
  const turnRejection = await storyRejection(runTurn(modules.turn, f.owner.id, created.run, 'not allowed', randomUUID(), created.run.revision), 'turn on draft');
  assert.equal(turnRejection.status, 422);
  assert.equal(turnRejection.code, 'STORY_OFFLINE');
  const read = await modules.runService.readStoryRun(f.owner.id, created.run.id);
  assert.equal(read.run.id, created.run.id);
  return {result: 'PASS', reason: '下架模板拒绝新开和新回合，已有故事历史仍可读取'};
}

async function a09_002({db, modules}) {
  const [, shareModule] = await w07Services();
  const f = await createStoryFixture(db, 'a09-002');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const events = await runTurn(modules.turn, f.owner.id, created.run, '分享片段', randomUUID(), 0);
  const receipt = events.find(e => e.type === 'committed');
  const {share} = await shareModule.createStoryShare(f.owner.id, created.run.id, {title: '撤回测试', messageIds: [receipt.userMessageId, receipt.assistantMessageId]});
  const withdrawn = await shareModule.withdrawStoryShare(f.owner.id, created.run.id, share.id);
  assert.equal(withdrawn.share.status, 'WITHDRAWN');
  const stored = await db.storyShare.findUniqueOrThrow({where: {id: share.id}});
  assert.ok(stored.withdrawnAt);
  assert.equal(JSON.parse(stored.snapshotJson).fragments.length, 2);
  const retry = await storyRejection(shareModule.withdrawStoryShare(f.owner.id, created.run.id, share.id), 'repeat withdraw');
  assert.equal(retry.status, 409);
  const foreign = await storyRejection(shareModule.withdrawStoryShare(f.stranger.id, created.run.id, share.id), 'foreign withdraw');
  assert.equal(foreign.status, 404);
  return {result: 'PASS', reason: '撤回标记持久化且重复撤回/他人撤回被拒；reader-facing HTTP 可读性仍需端点验收'};
}

async function a09_003({db, modules}) {
  const f = await createStoryFixture(db, 'a09-003');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const message = await db.message.create({data: {conversationId: created.run.conversationId, role: 'ASSISTANT', content: 'safe public line'}});
  const turn = await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'reviewed-fact', requestHash: 'fixture', operation: 'SEND', status: 'COMMITTED', stateStatus: 'PROCESSED', startedAt: new Date(), committedAt: new Date(), assistantMessageId: message.id}});
  await db.storyEvent.create({data: {runId: created.run.id, sourceTurnId: turn.id, chapterKey: 'opening', type: 'FACT', status: 'CONFIRMED', sourceMessageId: message.id, payloadJson: JSON.stringify({schemaVersion: 1, publicSummary: 'safe public line', hidden: 'SECRET_PLOT'})}});
  const view = await modules.runService.readStoryRun(f.owner.id, created.run.id);
  const [, , , exports] = await w07Services();
  const archive = await exports.exportStoryRun(f.owner.id, created.run.id);
  for (const value of [JSON.stringify(view), JSON.stringify(archive)]) {
    assert.equal(value.includes('SECRET_PLOT'), false);
    assert.equal(value.includes('safe public line'), true);
  }
  return {result: 'PASS', reason: 'run view 与单 run 导出只投影公开事件摘要，不泄漏模板 hiddenFacts 字符串'};
}

async function a12_004({db, modules}) {
  const [, , worker] = await w07Services();
  const f = await createStoryFixture(db, 'a12-004');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const input = await db.message.create({data: {conversationId: created.run.conversationId, role: 'USER', content: 'preserved user'}});
  const reply = await db.message.create({data: {conversationId: created.run.conversationId, role: 'ASSISTANT', content: 'preserved reply'}});
  const turn = await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'deferred', requestHash: turnRequestHash('preserved user'), operation: 'SEND', status: 'COMMITTED', stateStatus: 'PENDING', startedAt: new Date(), committedAt: new Date(), inputMessageId: input.id, assistantMessageId: reply.id}});
  await db.storyRun.update({where: {id: created.run.id}, data: {lastCommittedTurnNo: 1, revision: 2}});
  const result = await worker.processPendingStateWork();
  assert.equal(result.processed, 1);
  assert.equal(await db.aiCall.count({where: {userId: f.owner.id}}), 0);
  assert.equal(await db.message.count({where: {conversationId: created.run.conversationId}}), 2);
  const turnAfter = await db.storyTurn.findUniqueOrThrow({where: {id: turn.id}});
  assert.equal(turnAfter.stateStatus, 'PROCESSED');
  assert.equal(turnAfter.stateAttempts, 1);
  assert.equal(await db.storyEvent.count({where: {runId: created.run.id}}), 1);
  const runAfter = await db.storyRun.findUniqueOrThrow({where: {id: created.run.id}});
  assert.equal(runAfter.stateProcessedThroughTurnNo, 1);
  return {result: 'PASS', reason: '整理调用不改变聊天费用记录，已提交的用户/角色消息保持原样'};
}

async function a12_006({db, modules}) {
  const [, , worker] = await w07Services();
  const f = await createStoryFixture(db, 'a12-006');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const input = await db.message.create({data: {conversationId: created.run.conversationId, role: 'USER', content: 'saved input'}});
  const reply = await db.message.create({data: {conversationId: created.run.conversationId, role: 'ASSISTANT', content: 'saved response'}});
  const turn = await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'budget-none', requestHash: turnRequestHash('saved input'), operation: 'SEND', status: 'COMMITTED', stateStatus: 'PENDING', startedAt: new Date(), committedAt: new Date(), inputMessageId: input.id, assistantMessageId: reply.id}});
  await db.storyRun.update({where: {id: created.run.id}, data: {lastCommittedTurnNo: 1, revision: 2}});
  const result = await worker.processPendingStateWork();
  assert.equal(result.processed, 1);
  assert.equal((await db.storyTurn.findUniqueOrThrow({where: {id: turn.id}})).status, 'COMMITTED');
  assert.deepEqual((await db.message.findMany({where: {conversationId: created.run.conversationId}, orderBy: {role: 'asc'}})).map(m => m.content).sort(), ['saved input', 'saved response'].sort());
  return {result: 'PASS', reason: '状态整理后已保存内容完整保留，worker 不替换或伪造聊天回复'};
}

async function a13_001({db, modules}) {
  const [privacy] = await w07Services();
  const f = await createStoryFixture(db, 'a13-001');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  await db.$transaction(tx => privacy.eraseAccountConversations(tx, f.owner.id));
  for (const model of ['storyRun', 'storyTurn', 'storyEvent', 'storyCheckpoint', 'storyShare']) assert.equal(await db[model].count({where: {run: {userId: f.owner.id}}}).catch(async () => db[model].count({where: {userId: f.owner.id}})), 0, model);
  assert.equal(await db.conversation.count({where: {id: created.run.conversationId}}), 0);
  return {result: 'PASS', reason: '账户会话清理后 run/turn/event/checkpoint/share 与关联会话均无残留'};
}

async function a13_002({db, modules}) {
  const [, , , exports] = await w07Services();
  const f = await createStoryFixture(db, 'a13-002');
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  const turn = await db.storyTurn.create({data: {runId: created.run.id, turnNo: 1, requestId: 'export', requestHash: 'x', operation: 'SEND', status: 'COMMITTED', stateStatus: 'PROCESSED', startedAt: new Date(), committedAt: new Date()}});
  await db.storyEvent.create({data: {runId: created.run.id, sourceTurnId: turn.id, chapterKey: 'opening', type: 'FACT', status: 'CONFIRMED', payloadJson: JSON.stringify({schemaVersion: 1, publicSummary: 'own public fact', hidden: 'SECRET_PLOT'})}});
  const archive = await exports.exportStoryRun(f.owner.id, created.run.id);
  const own = await db.$transaction(tx => exports.exportAccountStories(tx, f.owner.id));
  const stranger = await storyRejection(exports.exportStoryRun(f.stranger.id, created.run.id), 'foreign export');
  assert.equal(stranger.status, 404);
  assert.equal(own.length, 1);
  for (const serialized of [JSON.stringify(archive), JSON.stringify(own)]) {
    assert.equal(serialized.includes('SECRET_PLOT'), false);
    assert.equal(serialized.includes('own public fact'), true);
  }
  return {result: 'PASS', reason: '单 run 与账户故事导出包含本人公开投影、拒绝他人导出且不含隐藏事实'};
}

const SCENARIOS = new Map([
  ['EV-A04-002', a04_002],
  ['EV-A04-004', a04_004],
  ['EV-A07-002', a07_002],
  ['EV-A08-001', a08_001],
  ['EV-A08-002', a08_002],
  ['EV-A09-003', a09_003],
  ['EV-A13-001', a13_001],
  ['EV-A13-002', a13_002],
  ['EV-A01-001', a01_001],
  ['EV-A01-002', a01_002],
  ['EV-A01-006', a01_006],
  ['EV-A02-001', a02_001],
  ['EV-A02-002', a02_002],
  ['EV-A02-003', a02_003],
  ['EV-A02-004', a02_004],
  ['EV-A03-002', a03_002],
  ['EV-A04-001', a04_001],
  ['EV-A04-003', a04_003],
  ['EV-A06-001', a06_001],
  ['EV-A06-002', a06_002],
  ['EV-A06-005', a06_005],
  ['EV-A06-006', a06_006],
  ['EV-A12-002', a12_002],
]);

/** domain 层执行器：加载隔离环境后按 id 分派剧本。 */
export async function domainExecutor(c) {
  const scenario = SCENARIOS.get(c.id);
  if (!scenario) {
    return {result: 'FAIL', reason: `domain 执行器缺少用例 ${c.id} 的自动剧本（框架缺陷，不得静默放行）`};
  }
  const env = await storyEvaluationEnvironment();
  const outcome = await scenario(env);
  // 剧本通过后把用例标记为最近一次真实执行通过；verified 语义由运行记录支撑。
  return {result: outcome.result, reason: outcome.reason};
}
