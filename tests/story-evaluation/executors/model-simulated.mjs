// W08 评测框架 · model-simulated 执行器（w08-eval-plan.md 第 6 节）。
// 在 DISABLE_MOCK_AI=false 的模拟模式下，对剧情回合的 SSE 事件流做自动断言：
//   1. 事件序列符合规划书第 19 章契约：accepted → (demo|delta…) → committed → state_pending → done；
//   2. demo 标记可区分（测试回复不可包装成真实 AI 生成）；
//   3. 同键重放不发模型：重放流恰为 committed → state_pending → done，调用记录不增加。
// model-output 类断言（后续回复是否遵守事实）不允许自动判分：结构断言通过后结果记
// PENDING 并写入人工复核队列，绝不伪造语义通过。
//
// 说明：当前阶段「模拟上游」由应用内置 mock 回复承担（streamMockResponse），
// 可区分的 demo 事件即模拟口径；接入独立模拟上游适配器后，本执行器的事件序列
// 断言不变，demo 检查替换为上游标记检查。

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collectStreamEvents, createStoryFixture, storyEvaluationEnvironment} from './harness.mjs';

function assertSseContract(events, label) {
  assert.ok(events.length >= 4, `${label}: 事件数量不足`);
  assert.equal(events[0].type, 'accepted', `${label}: 首事件必须是 accepted`);
  assert.ok(events[0].turnId, `${label}: accepted 必须带 turnId`);
  assert.equal(typeof events[0].revision, 'number', `${label}: accepted 必须带 revision`);
  const types = events.map(e => e.type);
  assert.ok(types.includes('demo'), `${label}: 模拟回复必须带可区分的 demo 标记`);
  const deltas = events.filter(e => e.type === 'delta');
  assert.ok(deltas.length > 0, `${label}: 必须存在 delta 事件`);
  assert.ok(deltas.every(e => typeof e.content === 'string' && e.content.length > 0), `${label}: delta 必须携带正文片段`);
  const committedIndex = types.lastIndexOf('committed');
  assert.ok(committedIndex > 0, `${label}: 必须存在 committed 事件`);
  const committed = events[committedIndex];
  assert.ok(committed.userMessageId && committed.assistantMessageId, `${label}: committed 必须返回最终消息标识`);
  const tail = types.slice(committedIndex);
  assert.deepEqual(tail, ['committed', 'state_pending', 'done'], `${label}: 尾部必须是 committed → state_pending → done`);
  const turnIds = new Set(events.map(e => e.turnId));
  assert.equal(turnIds.size, 1, `${label}: 所有事件共享同一 turnId`);
}

/** 对一个 model-simulated 用例执行标准剧本：首轮生成 + 同键重放。 */
async function runSimulatedScenario(env, c) {
  const {db, modules} = env;
  const f = await createStoryFixture(db, c.id.toLowerCase());
  const created = await modules.runService.createStoryRun(f.owner.id, f.createInput);
  // 剧情输入取自用例步骤，保证运行记录与用例定义可对应。
  const content = `[${c.id}] ${c.steps[0].action}`;
  const events = await collectStreamEvents(modules.turn.executeStoryTurn({
    userId: f.owner.id,
    runId: created.run.id,
    input: {expectedRevision: 0, requestId: c.id, content},
    signal: new AbortController().signal,
  }));
  assertSseContract(events, `${c.id} 首轮`);
  assert.equal(events.at(-1).type, 'done');

  const callsAfterFirst = await db.aiCall.count({where: {userId: f.owner.id}});
  const replay = await collectStreamEvents(modules.turn.executeStoryTurn({
    userId: f.owner.id,
    runId: created.run.id,
    input: {expectedRevision: events[0].revision, requestId: c.id, content},
    signal: new AbortController().signal,
  }));
  assert.deepEqual(replay.map(e => e.type), ['committed', 'state_pending', 'done'], `${c.id}: 同键重放不重新生成`);
  assert.equal(replay[0].turnId, events[0].turnId, `${c.id}: 重放返回同一 turnId`);
  const callsAfterReplay = await db.aiCall.count({where: {userId: f.owner.id}});
  assert.equal(callsAfterReplay, callsAfterFirst, `${c.id}: 重放不得再结算外部模型调用`);
  assert.equal(await db.message.count({where: {conversationId: created.run.conversationId}}), 2, `${c.id}: 重放不重复落消息`);
  return {first: events, replay};
}

/**
 * model-simulated 层执行器。
 * SSE 契约自动判定通过后，语义断言进人工复核队列 → 结果记 PENDING（不计通过）。
 */
export async function modelSimulatedExecutor(c) {
  const env = await storyEvaluationEnvironment();
  await runSimulatedScenario(env, c);
  const reviewAssertions = c.assertions.filter(a => a.kind === 'model-output' || a.kind === 'state');
  const reviewTargets = reviewAssertions.map(a => a.target).join('、') || '全部断言';
  return {
    result: 'PENDING',
    reason: 'SSE 事件流契约自动断言通过（accepted/demo/delta/committed/state_pending/done、同键重放不发模型）；model-output 语义断言不自动判分，进人工复核队列',
    review: {
      queue: 'model-output 人工复核队列',
      case: c.id,
      assertions: reviewAssertions.map(a => `${a.target}: ${a.expect}`),
      note: `复核基准：docs/content/drafts/ 的种子案例与 confirmed 事实清单；模拟输出（demo 标记）不作为语义准确性证据。运行键 requestId=${c.id}，可复跑追溯。`,
    },
  };
}
