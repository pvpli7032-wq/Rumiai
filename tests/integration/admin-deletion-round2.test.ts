import test from 'node:test';
import assert from 'node:assert/strict';

function expectStatus(status: number, pattern: RegExp = /./) {
  return (error: unknown) => {assert.equal((error as {status?: number}).status, status); assert.match(String((error as Error).message), pattern); return true;};
}

test('round2 deletion lifecycles use one isolated fixture and preserve user/history data', async t => {
  if (process.env.DATABASE_URL) throw new Error('Refusing deletion integration tests when DATABASE_URL is already set; fixture must own the isolated database.');
  const {createFixture} = await import('../helpers/sqlite-fixture.mjs');
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  const [{saveRole, deleteRole}, {readManagedCharacter, deleteManagedCharacterDraft}, {readAiProviderDeletion}, {readAiModelDeletion}] = await Promise.all([
    import('@rumiai/backend/modules/admin/management-service'),
    import('@rumiai/backend/modules/characters/management-service'),
    import('@rumiai/backend/modules/ai/providers/management-service'),
    import('@rumiai/backend/modules/ai/models/management-service'),
  ]);

  await t.test('AI delete preflight returns fresh blockers without mutating rows', async () => {
    const provider = await fixture.db.aiProvider.create({data: {name: 'round2-provider', baseUrl: 'https://round2.example.test/v1', protocol: 'OPENAI_COMPATIBLE', isActive: false, version: 1}});
    const model = await fixture.db.aiModel.create({data: {key: 'round2-model', displayName: 'Round2 model', modelCode: 'round2-model-v1', providerId: provider.id, isActive: false, isDefault: false, isFallback: false, version: 1}});
    const providerCheck = await readAiProviderDeletion(fixture.admin.id, provider.id);
    assert.equal(providerCheck.canDelete, false);
    assert.deepEqual(providerCheck.blockers, ['MODELS']);
    assert.equal(providerCheck.references.models, 1);
    await fixture.db.aiProvider.update({where: {id: provider.id}, data: {isActive: true}});
    assert.deepEqual((await readAiProviderDeletion(fixture.admin.id, provider.id)).blockers, ['ACTIVE', 'MODELS']);
    await fixture.db.aiProvider.update({where: {id: provider.id}, data: {isActive: false}});
    const modelCheck = await readAiModelDeletion(fixture.admin.id, model.id);
    assert.equal(modelCheck.canDelete, true);
    assert.deepEqual(modelCheck.blockers, []);
    await fixture.db.aiModel.update({where: {id: model.id}, data: {isActive: true, isDefault: true}});
    const activeCheck = await readAiModelDeletion(fixture.admin.id, model.id);
    assert.deepEqual(activeCheck.blockers, ['ACTIVE', 'DEFAULT']);
    await assert.rejects(() => readAiProviderDeletion(fixture.user.id, provider.id), expectStatus(403, /权限/));
    await assert.rejects(() => readAiModelDeletion(fixture.user.id, model.id), expectStatus(403, /权限/));
    assert.ok(await fixture.db.aiModel.findUnique({where: {id: model.id}}));
  });

  await t.test('only unassigned custom admin roles can be deleted', async () => {
    const custom = await saveRole(fixture.admin.id, {name: 'Round2 disposable role', permissions: ['analytics.read'], reason: 'round2 create role'});
    assert.equal((await deleteRole(fixture.admin.id, custom.id, {version: custom.version, reason: 'round2 unused role'})).deleted, true);
    assert.equal(await fixture.db.adminRole.findUnique({where: {id: custom.id}}), null);
    assert.ok(await fixture.db.adminAuditLog.findFirst({where: {action: 'DELETE_ROLE', targetId: custom.id}}));

    const system = await fixture.db.adminRole.findUniqueOrThrow({where: {code: 'OWNER'}});
    await assert.rejects(() => deleteRole(fixture.admin.id, system.id, {version: system.version, reason: 'must reject system role'}), expectStatus(409, /系统角色/));

    const assigned = await saveRole(fixture.admin.id, {name: 'Round2 assigned role', permissions: ['analytics.read'], reason: 'round2 assigned role'});
    await fixture.db.adminRoleAssignment.create({data: {userId: fixture.admin.id, roleId: assigned.id}});
    await assert.rejects(() => deleteRole(fixture.admin.id, assigned.id, {version: assigned.version + 1, reason: 'stale role version'}), expectStatus(409, /刷新/));
    await assert.rejects(() => deleteRole(fixture.admin.id, assigned.id, {version: assigned.version, reason: 'must reject assigned role'}), expectStatus(409, /管理账号/));
    assert.ok(await fixture.db.adminRole.findUnique({where: {id: assigned.id}}));
    await assert.rejects(() => deleteRole(fixture.user.id, assigned.id, {version: assigned.version, reason: 'permission guard'}), expectStatus(403, /权限/));
    const invalidReason = await saveRole(fixture.admin.id, {name: 'Round2 invalid reason role', permissions: ['analytics.read'], reason: 'round2 invalid reason role'});
    await assert.rejects(() => deleteRole(fixture.admin.id, invalidReason.id, {version: invalidReason.version, reason: ''}), expectStatus(400, /理由/));
    assert.ok(await fixture.db.adminRole.findUnique({where: {id: invalidReason.id}}));
  });

  await t.test('only unused site-owned character drafts can be deleted', async () => {
    const unused = await fixture.db.character.create({data: {name: 'Round2 unused site draft', personality: 'test', background: 'test', creatorId: null, reviewStatus: 'DRAFT', isPublic: false, publicationRequested: false}});
    const unusedView = await readManagedCharacter(fixture.admin.id, unused.id);
    assert.equal(unusedView.deletion.canDelete, true);
    assert.equal((await deleteManagedCharacterDraft(fixture.admin.id, unused.id, {updatedAt: unused.updatedAt.toISOString(), reason: 'round2 unused draft'})).deleted, true);
    assert.equal(await fixture.db.character.findUnique({where: {id: unused.id}}), null);
    assert.ok(await fixture.db.adminAuditLog.findFirst({where: {action: 'DELETE_UNUSED_CHARACTER_DRAFT', targetId: unused.id}}));

    const referenced = await fixture.db.character.create({data: {name: 'Round2 referenced site draft', personality: 'test', background: 'test', creatorId: null, reviewStatus: 'DRAFT', isPublic: false, publicationRequested: false}});
    const conversation = await fixture.db.conversation.create({data: {userId: fixture.user.id, characterId: referenced.id}});
    const referencedView = await readManagedCharacter(fixture.admin.id, referenced.id);
    assert.equal(referencedView.deletion.canDelete, false);
    assert.equal(referencedView.deletion.references.conversations, 1);
    await assert.rejects(() => deleteManagedCharacterDraft(fixture.admin.id, referenced.id, {updatedAt: new Date(referenced.updatedAt.getTime() - 1000).toISOString(), reason: 'stale character version'}), expectStatus(409, /刷新/));
    await assert.rejects(() => deleteManagedCharacterDraft(fixture.admin.id, referenced.id, {updatedAt: referenced.updatedAt.toISOString(), reason: 'must preserve conversation'}), expectStatus(409, /业务引用/));
    assert.ok(await fixture.db.conversation.findUnique({where: {id: conversation.id}}));
    assert.ok(await fixture.db.character.findUnique({where: {id: referenced.id}}));

    const creatorOwned = await fixture.db.character.create({data: {name: 'Round2 creator draft', personality: 'test', background: 'test', creatorId: fixture.user.id, reviewStatus: 'DRAFT', isPublic: false, publicationRequested: false}});
    await assert.rejects(() => deleteManagedCharacterDraft(fixture.admin.id, creatorOwned.id, {updatedAt: creatorOwned.updatedAt.toISOString(), reason: 'must preserve user draft'}), expectStatus(409, /个人作者/));
    const submitted = await fixture.db.character.create({data: {name: 'Round2 submitted role', personality: 'test', background: 'test', creatorId: null, reviewStatus: 'REJECTED', isPublic: false, publicationRequested: true}});
    await assert.rejects(() => deleteManagedCharacterDraft(fixture.admin.id, submitted.id, {updatedAt: submitted.updatedAt.toISOString(), reason: 'must preserve review history'}), expectStatus(409, /审核历史/));
    const unauthorized = await fixture.db.character.create({data: {name: 'Round2 permission guard draft', personality: 'test', background: 'test', creatorId: null, reviewStatus: 'DRAFT', isPublic: false, publicationRequested: false}});
    await assert.rejects(() => deleteManagedCharacterDraft(fixture.user.id, unauthorized.id, {updatedAt: unauthorized.updatedAt.toISOString(), reason: 'permission guard'}), expectStatus(403, /权限/));
    assert.ok(await fixture.db.character.findUnique({where: {id: unauthorized.id}}));
    const invalidReason = await fixture.db.character.create({data: {name: 'Round2 invalid reason draft', personality: 'test', background: 'test', creatorId: null, reviewStatus: 'DRAFT', isPublic: false, publicationRequested: false}});
    await assert.rejects(() => deleteManagedCharacterDraft(fixture.admin.id, invalidReason.id, {updatedAt: invalidReason.updatedAt.toISOString(), reason: ''}), expectStatus(400, /理由/));
    assert.ok(await fixture.db.character.findUnique({where: {id: invalidReason.id}}));
  });
});
