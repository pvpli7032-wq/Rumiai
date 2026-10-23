import test from 'node:test';
import assert from 'node:assert/strict';

const missionInput = (overrides: Record<string, unknown> = {}) => ({title: 'E2E mission', description: '', rewardCoins: 1, category: 'DAILY', conditionType: 'CHECKIN_COUNT', conditionTarget: 1, period: 'DAILY', isActive: false, sortOrder: 1, startsAt: null, endsAt: null, reason: 'E2E delete test', ...overrides});
const giftInput = (overrides: Record<string, unknown> = {}) => ({code: 'e2e-gift', name: 'E2E 礼物', description: '', emoji: '🎁', coinPrice: 1, isActive: false, sortOrder: 1, reason: 'E2E delete test', ...overrides});
const packageInput = (overrides: Record<string, unknown> = {}) => ({label: 'E2E 套餐', coins: 10, bonus: 0, priceCnyCents: 100, sortOrder: 1, isActive: false, bonusStartsAt: null, bonusEndsAt: null, reason: 'E2E delete test', ...overrides});

function expectStatus(status: number, pattern: RegExp = /./) {
  return (error: unknown) => { assert.equal((error as {status?: number}).status, status); assert.match(String((error as Error).message), pattern); return true; };
}

test('admin deletion services use one isolated fixture and preserve referenced history', async t => {
  if (process.env.DATABASE_URL) throw new Error('Refusing deletion integration tests when DATABASE_URL is already set; fixture must own the isolated database.');
  const {createFixture} = await import('../helpers/sqlite-fixture.mjs');
  const fixture = await createFixture(); t.after(() => fixture.cleanup());
  const [{saveManagedMission, deleteManagedMission}, {saveGiftCatalogItem, deleteGiftCatalogItem}, {createManagedPackage, deleteManagedPackage}, {changeSiteContent, listSiteContentRevisions, restoreSiteContentRevision}] = await Promise.all([
    import('@rumiai/backend/modules/missions/management-service'), import('@rumiai/backend/modules/gifts/catalog-service'), import('@rumiai/backend/modules/coins/package-management'), import('@rumiai/backend/modules/site-content/management-service'),
  ]);

  await t.test('mission guards and audit', async () => {
    const created = await saveManagedMission(fixture.admin.id, missionInput());
    assert.equal((await deleteManagedMission(fixture.admin.id, created.id, {version: created.version, reason: 'success'})).deleted, true);
    const active = await saveManagedMission(fixture.admin.id, missionInput({title: 'active', isActive: true}));
    await assert.rejects(() => deleteManagedMission(fixture.admin.id, active.id, {version: active.version, reason: 'active'}), expectStatus(409, /先停用/));
    const historical = await saveManagedMission(fixture.admin.id, missionInput({title: 'history'}));
    await fixture.db.userMission.create({data: {userId: fixture.user.id, missionId: historical.id, periodKey: 'ONCE'}});
    await assert.rejects(() => deleteManagedMission(fixture.admin.id, historical.id, {version: historical.version, reason: 'history'}), expectStatus(409, /领取记录/));
    assert.ok(await fixture.db.mission.findUnique({where: {id: historical.id}}));
    await assert.rejects(() => deleteManagedMission(fixture.admin.id, historical.id, {version: historical.version + 1, reason: 'version'}), expectStatus(409, /其他操作修改/));
    await assert.rejects(() => deleteManagedMission(fixture.user.id, historical.id, {version: historical.version, reason: 'permission'}), expectStatus(403, /权限/));
    assert.ok(await fixture.db.adminAuditLog.findFirst({where: {action: 'DELETE_GROWTH_MISSION', targetId: created.id}}));
  });

  await t.test('gift guards including legacy giftType and audit', async () => {
    const active = await saveGiftCatalogItem(fixture.admin.id, giftInput({code: 'active-gift', isActive: true}));
    await assert.rejects(() => deleteGiftCatalogItem(fixture.admin.id, active.id, {version: active.version, reason: 'active'}), expectStatus(409, /先停用/));
    const created = await saveGiftCatalogItem(fixture.admin.id, giftInput({code: 'deletable-gift'}));
    assert.equal((await deleteGiftCatalogItem(fixture.admin.id, created.id, {version: created.version, reason: 'success'})).deleted, true);
    const historical = await saveGiftCatalogItem(fixture.admin.id, giftInput({code: 'legacy-gift'}));
    const character = await fixture.db.character.create({data: {name: 'E2E character', personality: 'kind', background: 'test'}});
    await fixture.db.gift.create({data: {senderId: fixture.user.id, characterId: character.id, catalogId: null, giftType: historical.code, amount: 1}});
    await assert.rejects(() => deleteGiftCatalogItem(fixture.admin.id, historical.id, {version: historical.version, reason: 'legacy'}), expectStatus(409, /赠送记录/));
    assert.ok(await fixture.db.giftCatalogItem.findUnique({where: {id: historical.id}}));
    await assert.rejects(() => deleteGiftCatalogItem(fixture.admin.id, historical.id, {version: historical.version + 1, reason: 'version'}), expectStatus(409, /其他操作修改/));
    await assert.rejects(() => deleteGiftCatalogItem(fixture.user.id, historical.id, {version: historical.version, reason: 'permission'}), expectStatus(403, /权限/));
    assert.ok(await fixture.db.adminAuditLog.findFirst({where: {action: 'DELETE_GIFT_CATALOG', targetId: created.id}}));
  });

  await t.test('coin package guards and audit', async () => {
    const created = await createManagedPackage(fixture.admin.id, packageInput());
    assert.equal((await deleteManagedPackage(fixture.admin.id, created.id, {version: created.version, reason: 'success'})).deleted, true);
    const active = await createManagedPackage(fixture.admin.id, packageInput({label: 'active', isActive: true}));
    await assert.rejects(() => deleteManagedPackage(fixture.admin.id, active.id, {version: active.version, reason: 'active'}), expectStatus(409, /先下架/));
    const historical = await createManagedPackage(fixture.admin.id, packageInput({label: 'history'}));
    await fixture.db.paymentOrder.create({data: {orderNo: 'E2E-PACKAGE-ORDER', idempotencyKey: 'e2e-package-order', userId: fixture.user.id, packageId: historical.id, packageCoins: 10, packageBonus: 0, coinAmount: 10, amountCnyCents: 100}});
    await assert.rejects(() => deleteManagedPackage(fixture.admin.id, historical.id, {version: historical.version, reason: 'history'}), expectStatus(409, /订单快照/));
    assert.ok(await fixture.db.coinPackage.findUnique({where: {id: historical.id}}));
    await assert.rejects(() => deleteManagedPackage(fixture.admin.id, historical.id, {version: historical.version + 1, reason: 'version'}), expectStatus(409, /其他操作修改/));
    await assert.rejects(() => deleteManagedPackage(fixture.user.id, historical.id, {version: historical.version, reason: 'permission'}), expectStatus(403, /权限/));
    assert.ok(await fixture.db.adminAuditLog.findFirst({where: {action: 'DELETE_COIN_PACKAGE', targetId: created.id}}));
  });

  await t.test('site content revision restore creates a draft without changing published content', async () => {
    const first = await changeSiteContent(fixture.admin.id, 'BADGE', null, {action: 'PUBLISH', reason: 'create badge', content: {emoji: '🧪', label: '初始徽章', sortOrder: 1, isActive: true}});
    const second = await changeSiteContent(fixture.admin.id, 'BADGE', first.id, {action: 'PUBLISH', version: first.version, reason: 'update badge', content: {emoji: '🧪', label: '更新徽章', sortOrder: 2, isActive: true}});
    const revisions = await listSiteContentRevisions(fixture.admin.id, 'BADGE', first.id);
    assert.deepEqual(revisions.map(item => item.version).sort((a, b) => a - b), [1, 2]);
    const original = revisions.find(item => item.version === 1);
    assert.ok(original);
    const restored = await restoreSiteContentRevision(fixture.admin.id, 'BADGE', first.id, original.id, {version: second.version, reason: 'restore original badge'});
    assert.equal(restored.status, 'DRAFT');
    assert.equal(restored.version, second.version + 1);
    const live = await fixture.db.badge.findUnique({where: {id: first.id}});
    assert.equal(live?.label, '更新徽章');
    assert.equal(live?.sortOrder, 2);
    const draft = await fixture.db.siteContentDraft.findUnique({where: {contentType_contentId: {contentType: 'BADGE', contentId: first.id}}});
    assert.equal(draft?.version, restored.version);
    assert.deepEqual(JSON.parse(draft?.draftJson ?? '{}'), {emoji: '🧪', label: '初始徽章', sortOrder: 1, isActive: true});
    const after = await listSiteContentRevisions(fixture.admin.id, 'BADGE', first.id);
    assert.deepEqual(after.map(item => item.version).sort((a, b) => a - b), [1, 2]);
  });
});
