import assert from 'node:assert/strict';
import test from 'node:test';
import type {AdminPermission} from '../../packages/contracts/src/admin/permissions';
import {
  ADMIN_NAV,
  activeNavHref,
  findEntry,
  visibleGroups,
} from '../../packages/contracts/src/admin/nav';

const ALL_PERMISSIONS = [...new Set(ADMIN_NAV.flatMap(group => group.entries.flatMap(entry => [
  entry.permission,
  ...(entry.children?.map(child => child.permission).filter(permission => permission !== undefined) ?? []),
])).filter((permission): permission is AdminPermission => permission !== null && permission !== undefined))];

test('navigation has seven stable business domains and each primary route has one owner', () => {
  assert.deepEqual(ADMIN_NAV.map(group => group.label), ['工作台','账户与权益','内容与社区','活动与玩法','AI 平台','财务与支付','系统与安全']);
  const entries = ADMIN_NAV.flatMap(group => group.entries);
  assert.equal(entries.length, 25);
  assert.equal(new Set(entries.map(entry => entry.href)).size, entries.length);
  assert.equal(ADMIN_NAV.find(group => group.id === 'ai')?.entries.some(entry => entry.href.startsWith('/admin/finance')), false);
  assert.equal(ADMIN_NAV.find(group => group.id === 'finance')?.entries.some(entry => entry.href.startsWith('/admin/ai')), false);
});

test('permission filtering removes inaccessible entries, children and empty groups', () => {
  const groups = visibleGroups(['settings.read']);
  assert.deepEqual(groups.map(group => group.id), ['workbench','system']);
  assert.deepEqual(groups[0].entries.map(entry => entry.href), ['/admin']);
  assert.deepEqual(groups[1].entries.map(entry => entry.href), ['/admin/settings']);
  assert.deepEqual(groups[1].entries[0].children?.map(child => child.label), ['聊天与内容','计费额度','玩法参数','账号运行','提示词']);
});

test('active ownership selects one exact child and falls back for legacy or invalid tabs', () => {
  assert.equal(activeNavHref('/admin/finance', ALL_PERMISSIONS), '/admin/finance');
  assert.equal(activeNavHref('/admin/finance?tab=refunds', ALL_PERMISSIONS), '/admin/finance?tab=refunds');
  assert.equal(activeNavHref('/admin/finance?tab=unknown', ALL_PERMISSIONS), '/admin/finance');
  assert.equal(activeNavHref('/admin/site-content?tab=branding', ALL_PERMISSIONS), '/admin/site-content?tab=branding');
  assert.equal(activeNavHref('/admin/settings?tab=prompts&section=prompts-templates', ALL_PERMISSIONS), '/admin/settings?tab=prompts&section=prompts-templates');
  assert.equal(activeNavHref('/admin/settings?tab=billing&section=billing-settlement', ALL_PERMISSIONS), '/admin/settings?tab=billing&section=billing-base');
  assert.equal(activeNavHref('/admin/settings?section=chat-posts', ALL_PERMISSIONS), '/admin/settings?section=chat-input');
  assert.equal(activeNavHref('/admin/finance?tab=merchants', ALL_PERMISSIONS), '/admin/payments/merchants');
  const match = findEntry('/admin/community/posts/example', ALL_PERMISSIONS);
  assert.equal(match?.group.id, 'content');
  assert.equal(match?.entry.href, '/admin/community/posts');
  assert.equal(match?.child, null);
});

test('every nested area exposes one default and unique URL-addressable leaves', () => {
  const nested = ADMIN_NAV.flatMap(group => group.entries).filter(entry => entry.children?.length);
  assert.deepEqual(nested.map(entry => entry.href), [
    '/admin/site-content','/admin/mirror','/admin/growth','/admin/ai/costs','/admin/finance','/admin/settings','/admin/operations',
  ]);
  for (const entry of nested) {
    const children = entry.children ?? [];
    assert.equal(children.filter(child => child.default).length, 1, entry.href);
    assert.equal(new Set(children.map(child => child.href)).size, children.length, entry.href);
    for (const child of children) {
      const match = findEntry(child.href, ALL_PERMISSIONS);
      assert.equal(match?.entry.href, entry.href);
      assert.equal(match?.child?.href, child.href);
    }
  }
});

test('account capabilities are searchable metadata, not fake links without a selected user', () => {
  const account = ADMIN_NAV.flatMap(group => group.entries).find(entry => entry.href === '/admin/accounts');
  assert.ok(account?.keywords?.includes('会员与资产'));
  assert.equal(account?.children, undefined);
});
