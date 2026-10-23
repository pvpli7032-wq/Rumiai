import assert from 'node:assert/strict';
import test from 'node:test';
import {SETTING_GROUPS, definitionsOfGroup} from '@rumiai/contracts/settings/registry';
import {sectionCoverage, sectionsOfGroup, visibleDefinitionsOfGroup} from '../../apps/admin/src/components/settings/sections';
import {buildSettingSearchIndex, searchSettings, shouldConfirmSettingNavigation} from '../../apps/admin/src/components/settings/search';

test('settings display sections cover every visible registry key exactly once', () => {
  const all = SETTING_GROUPS.flatMap(group => visibleDefinitionsOfGroup(group.id));
  const covered = SETTING_GROUPS.flatMap(group => sectionCoverage(group.id).sections.flatMap(section => section.definitions));
  assert.equal(all.length, 107, 'visible registry count must remain explicit');
  assert.equal(covered.length, all.length);
  assert.equal(new Set(covered.map(item => item.key)).size, all.length);
  for (const group of SETTING_GROUPS) {
    const coverage = sectionCoverage(group.id);
    assert.equal(coverage.total, definitionsOfGroup(group.id).filter(item => !item.hidden).length, group.id);
    assert.deepEqual(coverage.duplicates, [], `${group.id} has duplicate display ownership`);
    assert.deepEqual(coverage.missing, [], `${group.id} has unassigned visible settings`);
  }
});

test('large groups expose focused subsections', () => {
  assert.deepEqual(sectionsOfGroup('chat').map(item => item.id), ['chat-input', 'chat-posts', 'chat-comments', 'chat-characters', 'chat-upload', 'chat-frequency']);
  assert.deepEqual(sectionsOfGroup('billing').map(item => item.id), ['billing-base', 'billing-settlement', 'billing-story', 'billing-story-runtime', 'billing-cost', 'billing-ai-budget']);
  assert.deepEqual(sectionsOfGroup('growth').map(item => item.id), ['growth-grant', 'growth-invite', 'growth-mirror-entry', 'growth-mirror-purchase', 'growth-mirror-content', 'growth-dispute-entry', 'growth-dispute-resolution', 'growth-memory', 'growth-tasks']);
});

test('global search respects the AI cost permission and dirty navigation boundary', () => {
  const groups = SETTING_GROUPS.map(group => ({id: group.id, label: group.label}));
  const withoutCosts = buildSettingSearchIndex(groups, false);
  const withCosts = buildSettingSearchIndex(groups, true);
  assert.equal(withoutCosts.some(item => item.definition.hidden), false);
  assert.equal(withCosts.filter(item => item.definition.hidden).length, 5);
  assert.ok(searchSettings(withCosts, '聊天用模型').every(item => item.definition.hidden));
  assert.equal(shouldConfirmSettingNavigation(true, 'billing', 'billing'), false);
  assert.equal(shouldConfirmSettingNavigation(true, 'chat', 'billing'), true);
  assert.equal(shouldConfirmSettingNavigation(true, 'billing', 'billing', '/admin/ai/costs'), true);
  assert.equal(shouldConfirmSettingNavigation(false, 'chat', 'billing'), false);
});
