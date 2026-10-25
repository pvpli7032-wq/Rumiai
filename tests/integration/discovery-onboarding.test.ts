import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('catalogue pagination, interest preview and CMS recommendations use server data', async t => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  await fixture.db.operationSetting.createMany({data: [
    {key: 'growth.onboardingEnabled', group: 'growth', value: 'true', updatedBy: fixture.admin.id},
    {key: 'growth.interestTags', group: 'growth', value: JSON.stringify(['rare']), updatedBy: fixture.admin.id},
    {key: 'growth.recommendationLimit', group: 'growth', value: '2', updatedBy: fixture.admin.id},
    {key: 'growth.openingSuggestions', group: 'growth', value: JSON.stringify(['你好，想听听你的故事。']), updatedBy: fixture.admin.id},
    {key: 'discovery.railLimit', group: 'growth', value: '3', updatedBy: fixture.admin.id},
    {key: 'discovery.recommendationStrategy', group: 'growth', value: JSON.stringify('POPULAR'), updatedBy: fixture.admin.id},
  ]});
  await fixture.db.character.createMany({data: Array.from({length: 60}, (_, i) => ({
    id: 'catalog-' + i, name: 'catalog-' + i, personality: 'fixture', background: '',
    creatorId: fixture.user.id, isPublic: true, reviewStatus: 'APPROVED', chatCount: 1000 - i,
    tags: 'ordinary',
  }))});
  const rare = await fixture.db.character.create({data: {
    name: 'rare catalogue character', personality: 'fixture', background: '', creatorId: fixture.user.id,
    isPublic: true, reviewStatus: 'APPROVED', chatCount: 0, tags: 'rare',
  }});
  const {readCharacterCatalogPage} = await import('@rumiai/backend/modules/characters/catalog-service');
  const first = await readCharacterCatalogPage({search: 'catalog-', limit: 17});
  assert.equal(first.items.length, 17);
  assert.equal(first.hasMore, true);
  const seen = new Set(first.items.map(row => row.id));
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await readCharacterCatalogPage({search: 'catalog-', limit: 17, cursor});
    for (const row of page.items) {assert.equal(seen.has(row.id), false);seen.add(row.id);}
    cursor = page.nextCursor;
  }
  assert.equal(seen.size, 60, 'characters beyond the old first fifty stay reachable');
  const matches = await readCharacterCatalogPage({search: 'rare catalogue', tags: ['rare']});
  assert.deepEqual(matches.items.map(row => row.id), [rare.id]);
  await assert.rejects(() => readCharacterCatalogPage({cursor: 'invalid'}), /游标/);
  const {readOnboarding} = await import('@rumiai/backend/modules/growth/onboarding-service');
  const preview = await readOnboarding(fixture.user.id, ['rare']);
  assert.equal(preview.recommended[0]?.id, rare.id, 'interest match outside hot pool comes first');
  assert.equal(preview.recommended.length, 2, 'configured recommendation size is consumed');
  assert.deepEqual(preview.openingSuggestions, ['你好，想听听你的故事。']);
  assert.ok(preview.openingMaxChars > 0);
  const {saveChanges} = await import('@rumiai/backend/modules/settings/service');
  await assert.rejects(() => saveChanges({changes: [{key: 'growth.openingSuggestions', value: [123]}], expectedVersions: {}, operatorId: fixture.admin.id}), /开场建议/);
  const user = await fixture.db.user.findUniqueOrThrow({where: {id: fixture.user.id}});
  assert.equal(user.onboardedAt, null, 'preview must not complete onboarding');
  assert.equal(user.interestsJson, null, 'preview must not save interests');
  const {readDiscoverProjection} = await import('@rumiai/backend/workflows/discover-projection');
  const discover = await readDiscoverProjection();
  assert.equal(discover.recommended.length, 3);
  assert.equal(discover.hot.length, 3);
  assert.deepEqual(discover.recommended.map(row => row.id), discover.hot.map(row => row.id));
});
