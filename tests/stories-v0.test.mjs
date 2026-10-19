import test from 'node:test';
import assert from 'node:assert/strict';

const {SCENE_CONFIGS, getSceneConfigByCharacterId} = await import('../src/lib/stories/scene-config.ts');
const {resolveScene, isSceneEntryComplete, getPublishedSceneConfigs} = await import('../src/lib/stories/scene-service.ts');
const {buildChapterCloseData} = await import('../src/lib/stories/chapter-close.ts');

const character = id => ({id, name: '测试角色', personality: 'synthetic'});

test('every shipped scene binds a unique character and passes the publication checks', () => {
  const ids = SCENE_CONFIGS.map(scene => scene.id);
  const characterIds = SCENE_CONFIGS.map(scene => scene.characterId);
  assert.equal(new Set(ids).size, ids.length, '场景 id 必须唯一');
  assert.equal(new Set(characterIds).size, characterIds.length, '同一角色一个版本只能绑定一个场景');
  for (const scene of SCENE_CONFIGS) {
    assert.equal(isSceneEntryComplete(scene), true, scene.id + ' 内容不完整');
    assert.equal(scene.suggestions.length, 3, scene.id + ' 必须恰好三条建议动作');
    assert.equal(new Set(scene.suggestions.map(s => s.id)).size, 3, scene.id + ' 建议动作 id 必须唯一');
    assert.ok(scene.suggestions.every(s => s.text.trim().length > 0), scene.id + ' 建议动作文案不能为空');
    assert.equal(new Set(scene.suggestions.map(s => s.text)).size, 3, scene.id + ' 三条建议动作必须是不同动作');
  }
  assert.equal(getPublishedSceneConfigs().length, SCENE_CONFIGS.length);
});

test('scene copy never claims completion, persistence or long-term memory', () => {
  const banned = ['已完成', '已保存', '下一章', '记住你', '记住', '永久', '会记得'];
  const copy = SCENE_CONFIGS.flatMap(scene => [
    scene.title, scene.hook, scene.userIdentity, scene.conflict, scene.goal,
    scene.opening ?? '', ...(scene.publicOpenQuestions ?? []), ...scene.suggestions.map(s => s.text),
  ]).join('\n');
  for (const phrase of banned) assert.equal(copy.includes(phrase), false, '场景文案不得出现：' + phrase);
});

test('resolveScene only opens for the bound, enabled and complete scene', () => {
  const scene = SCENE_CONFIGS[0];
  assert.equal(resolveScene(character(scene.characterId), scene).kind, 'available');
  assert.equal(resolveScene(character(scene.characterId)).reason, 'missing-config');
  assert.equal(resolveScene(character('someone-else'), scene).reason, 'incompatible-character');
  assert.equal(resolveScene(character(scene.characterId), {...scene, enabled: false}).reason, 'disabled');
  assert.equal(resolveScene(character(scene.characterId), {...scene, goal: ' '}).reason, 'incomplete-copy');
  assert.equal(resolveScene(character(scene.characterId), {...scene, suggestions: scene.suggestions.slice(0, 2)}).reason, 'incomplete-copy');
});

test('resolveScene degrades characters that have no scene instead of inventing one', () => {
  assert.equal(getSceneConfigByCharacterId('xingban-original-0'), undefined);
  assert.equal(resolveScene(character('xingban-original-0')).reason, 'missing-config');
});

test('chapter close selects real saved excerpts, never synthesises copy', () => {
  const messages = [
    {id: 'm1', role: 'USER', content: '我先听完了整段旋律。', createdAt: '2026-10-20T00:00:00.000Z'},
    {id: 'm2', role: 'ASSISTANT', content: '   ', createdAt: '2026-10-20T00:01:00.000Z'},
    {id: 'm3', role: 'ASSISTANT', content: '你觉得它缺的是结尾吗？', createdAt: '2026-10-20T00:02:00.000Z'},
    {id: 'm4', role: 'USER', content: 'x'.repeat(400), createdAt: '2026-10-20T00:03:00.000Z'},
  ];
  const data = buildChapterCloseData(messages);
  assert.equal(data.excerpts.length, 3, '默认最多三条');
  assert.equal(data.hasExcerpts, true);
  assert.deepEqual(data.excerpts.map(e => e.id), ['m1', 'm3', 'm4'], '跳过空内容并按时间取最近三条');
  assert.ok(data.excerpts[2].content.endsWith('…'));
  assert.equal(data.excerpts[2].content.length, 281);
  assert.equal(buildChapterCloseData([]).hasExcerpts, false);
  assert.equal(buildChapterCloseData(messages, 0).excerpts.length, 0, '上限可以是 0');
  assert.equal(buildChapterCloseData(messages, 10).excerpts.length, 3, '上限被夹到三条');
});