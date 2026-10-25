import assert from 'node:assert/strict';
import test from 'node:test';
import {SETTING_GROUPS, definitionsOfGroup} from '@rumiai/contracts/settings/registry';
import {sectionCoverage, sectionsOfGroup, visibleDefinitionsOfGroup} from '../../apps/admin/src/components/settings/sections';
import {buildSettingSearchIndex, searchSettings, shouldConfirmSettingNavigation} from '../../apps/admin/src/components/settings/search';

test('settings display sections cover every visible registry key exactly once', () => {
  const all = SETTING_GROUPS.flatMap(group => visibleDefinitionsOfGroup(group.id));
  const covered = SETTING_GROUPS.flatMap(group => sectionCoverage(group.id).sections.flatMap(section => section.definitions));
  assert.equal(covered.length, all.length);
  assert.deepEqual(covered.map(item => item.key).sort(), all.map(item => item.key).sort());
  assert.equal(new Set(covered.map(item => item.key)).size, all.length);
  for (const group of SETTING_GROUPS) {
    const coverage = sectionCoverage(group.id);
    assert.equal(coverage.total, definitionsOfGroup(group.id).filter(item => !item.hidden).length, group.id);
    assert.deepEqual(coverage.duplicates, [], `${group.id} has duplicate display ownership`);
    assert.deepEqual(coverage.missing, [], `${group.id} has unassigned visible settings`);
  }
});

test('large groups expose focused subsections', () => {
  assert.deepEqual(sectionsOfGroup('chat').map(item => item.id), ['chat-input', 'chat-relationship', 'chat-sharing', 'chat-suggestions', 'chat-posts', 'chat-comments', 'chat-characters', 'chat-upload', 'chat-frequency']);
  assert.deepEqual(sectionsOfGroup('billing').map(item => item.id), ['billing-base', 'billing-cancel', 'billing-settlement', 'billing-story', 'billing-story-runtime', 'billing-cost', 'billing-ai-budget']);
  assert.deepEqual(sectionsOfGroup('growth').map(item => item.id), ['growth-grant', 'growth-onboarding', 'growth-discovery', 'growth-invite', 'growth-affiliate', 'growth-mirror-entry', 'growth-mirror-purchase', 'growth-mirror-content', 'growth-dispute-entry', 'growth-dispute-resolution', 'growth-memory', 'growth-tasks']);
});

test('global search respects the AI cost permission and dirty navigation boundary', () => {
  const groups = SETTING_GROUPS.map(group => ({id: group.id, label: group.label}));
  const withoutCosts = buildSettingSearchIndex(groups, false);
  const withCosts = buildSettingSearchIndex(groups, true);
  assert.equal(withoutCosts.some(item => item.definition.hidden), false);
  const registeredHiddenKeys = SETTING_GROUPS.flatMap(group => definitionsOfGroup(group.id)).filter(item => item.hidden).map(item => item.key).sort();
  assert.deepEqual(withCosts.filter(item => item.definition.hidden).map(item => item.definition.key).sort(), registeredHiddenKeys);
  assert.ok(searchSettings(withCosts, '聊天用模型').every(item => item.definition.hidden));
  assert.equal(shouldConfirmSettingNavigation(true, 'billing', 'billing'), false);
  assert.equal(shouldConfirmSettingNavigation(true, 'chat', 'billing'), true);
  assert.equal(shouldConfirmSettingNavigation(true, 'billing', 'billing', '/admin/ai/costs'), true);
  assert.equal(shouldConfirmSettingNavigation(false, 'chat', 'billing'), false);
});

test('affiliate settings have one explicit display section with the exact configured keys', () => {
  const section = sectionsOfGroup('growth').find(item => item.id === 'growth-affiliate');
  assert.ok(section);
  assert.deepEqual(section.definitions.map(item => item.key).sort(), [
    'affiliate.enabled', 'affiliate.commissionPercent', 'affiliate.eligibleOrderTypes',
    'affiliate.settlementDelayHours', 'affiliate.minimumWithdrawalCents',
  ].sort());
});


test('decimal settings remain editable and upload limits belong to uploads', async () => {
  const {validateSettingValue} = await import('../../apps/admin/src/components/settings/format');
  const exchangeRate = definitionsOfGroup('billing').find(item => item.key === 'cost.exchangeRate')!;
  const messages = definitionsOfGroup('chat').find(item => item.key === 'chat.maxMessageChars')!;
  assert.equal(validateSettingValue(exchangeRate, 7.25), null);
  assert.equal(validateSettingValue(exchangeRate, -1), '不能小于 0。');
  assert.equal(validateSettingValue(messages, 1.5), '必须是整数。');
  const uploads = sectionsOfGroup('chat').find(item => item.id === 'chat-upload')!;
  assert.ok(uploads.definitions.some(item => item.key === 'limits.upload.perWindow'));
});
