import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStoryContext} from '../src/lib/stories/lifecycle/context-service.ts';
import {buildSystemPrompt} from '../src/lib/conversations/chat-stream.ts';

function fixture(facts = []) {
  return {chapterKey: 'ch-1', stateJson: JSON.stringify({schemaVersion: 1, chapterKey: 'ch-1', facts}), templateVersion: {template: {title: '夜航'}, definitionJson: JSON.stringify({schemaVersion: 1, publicSummary: '一段公开简介', chapters: [{key: 'ch-1', title: '第一章：灯下'}], hiddenFacts: ['secret']}), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: 'c', prompt: 'private prompt', leaseOwner: 'owner'})}};
}

test('context includes chapter, summary, and ordered facts', () => {
  const context = buildStoryContext(fixture(['先约定见面', '找到旧信']));
  assert.match(context, /故事：夜航/);
  assert.match(context, /当前章节：第一章：灯下/);
  assert.match(context, /公开简介：一段公开简介/);
  assert.ok(context.indexOf('先约定见面') < context.indexOf('找到旧信'));
});

test('context never leaks hidden or private fields', () => {
  const context = buildStoryContext(fixture(['公开事实']));
  for (const secret of ['hiddenFacts', 'secret', 'private prompt', 'leaseOwner', 'owner', 'requestHash', 'stateJson']) assert.equal(context.includes(secret), false, secret);
});

test('context with no facts still names the chapter', () => {
  const context = buildStoryContext(fixture());
  assert.match(context, /当前章节：第一章：灯下/);
  assert.match(context, /暂无已确认事实/);
});

test('context keeps the latest 40 facts and reports omission', () => {
  const facts = Array.from({length: 42}, (_, index) => '事实' + (index + 1));
  const context = buildStoryContext(fixture(facts));
  assert.match(context, /较早事实已省略 2 条/);
  assert.equal(/^1\. 事实1$/m.test(context), false);
  assert.equal(/^2\. 事实2$/m.test(context), false);
  assert.equal(/^3\. 事实3$/m.test(context), true);
  assert.equal(/^42\. 事实42$/m.test(context), true);
});

test('free-chat system prompt remains unchanged without context', () => {
  const character = {name: '角色', personality: '冷静', background: null};
  const before = buildSystemPrompt(character);
  assert.equal(buildSystemPrompt(character), before);
  assert.equal(before.includes('故事背景'), false);
});
