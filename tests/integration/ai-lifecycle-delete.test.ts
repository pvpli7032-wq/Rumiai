import test from 'node:test';
import assert from 'node:assert/strict';

function hasStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status;
}

test('AI provider/model deletion enforces dependencies, versions, permissions and audit history', async t => {
  assert.equal(process.env.DATABASE_URL, undefined, 'Refusing an external DATABASE_URL; fixture must own its temporary database.');
  const {createFixture} = await import('../helpers/sqlite-fixture.mjs');
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  const {deleteAiProvider} = await import('@rumiai/backend/modules/ai/providers/management-service');
  const {deleteAiModel} = await import('@rumiai/backend/modules/ai/models/management-service');
  const provider = await fixture.db.aiProvider.create({data: {name: 'delete-provider', baseUrl: 'https://delete.example.test/v1', protocol: 'OPENAI_COMPATIBLE', isActive: false, sortOrder: 99, version: 1}});
  const model = await fixture.db.aiModel.create({data: {key: 'delete-model', displayName: 'Delete model', modelCode: 'delete-model-v1', providerId: provider.id, isActive: false, isDefault: false, isFallback: false, version: 1}});
  await assert.rejects(() => deleteAiProvider(fixture.admin.id, provider.id, {version: 1, reason: 'provider dependency guard'}), error => hasStatus(error, 409) && /模型引用/.test(String(error)));
  for (const flags of [{key: 'active', isActive: true}, {key: 'default', isDefault: true}, {key: 'fallback', isFallback: true}]) {
    const guarded = await fixture.db.aiModel.create({data: {key: `guard-${flags.key}`, displayName: `Guard ${flags.key}`, modelCode: `guard-${flags.key}`, providerId: provider.id, isActive: flags.isActive ?? false, isDefault: flags.isDefault ?? false, isFallback: flags.isFallback ?? false, version: 1}});
    await assert.rejects(() => deleteAiModel(fixture.admin.id, guarded.id, {version: 1, reason: `guard ${flags.key}`}), error => hasStatus(error, 409));
    await fixture.db.aiModel.delete({where: {id: guarded.id}});
  }
  const character = await fixture.db.character.create({data: {name: 'Delete guard character', personality: 'test', background: 'test', creatorId: fixture.user.id}});
  await fixture.db.characterAiModel.create({data: {characterId: character.id, modelKey: model.key}});
  await assert.rejects(() => deleteAiModel(fixture.admin.id, model.id, {version: 1, reason: 'model dependency guard'}), error => hasStatus(error, 409) && /角色/.test(String(error)));
  await fixture.db.characterAiModel.delete({where: {characterId_modelKey: {characterId: character.id, modelKey: model.key}}});
  const conversation = await fixture.db.conversation.create({data: {userId: fixture.user.id, characterId: character.id, aiModel: model.key}});
  const price = await fixture.db.aiModelPrice.create({data: {modelId: model.id, currency: 'USD', inputPerMillionMicros: BigInt(1), outputPerMillionMicros: BigInt(1), effectiveAt: new Date('2026-01-01T00:00:00.000Z'), source: 'test', reason: 'test', createdBy: fixture.admin.id}});
  const coinPrice = await fixture.db.modelCoinPrice.create({data: {modelId: model.id, coinsPerReply: 1, effectiveAt: new Date('2026-01-02T00:00:00.000Z'), version: 1, createdBy: fixture.admin.id}});
  const call = await fixture.db.aiCall.create({data: {model: model.key, operation: 'TEST', currency: 'USD'}});
  await fixture.db.operationSetting.create({data: {key: 'ai.taskModel.chat', group: 'billing', value: JSON.stringify(model.key), updatedBy: fixture.admin.id}});
  await assert.rejects(() => deleteAiModel(fixture.admin.id, model.id, {version: 0, reason: 'stale version'}), error => hasStatus(error, 409));
  let dependencyError: unknown;
  await assert.rejects(() => deleteAiModel(fixture.admin.id, model.id, {version: 1, reason: 'dependency guard'}), error => { dependencyError = error; return hasStatus(error, 409); });
  assert.match(String(dependencyError), /会话/);
  assert.match(String(dependencyError), /成本价格/);
  assert.match(String(dependencyError), /币价/);
  assert.match(String(dependencyError), /AI 调用/);
  assert.match(String(dependencyError), /任务模型设置/);
  assert.equal((await fixture.db.conversation.findUnique({where: {id: conversation.id}}))?.aiModel, model.key);
  assert.equal((await fixture.db.aiModelPrice.findUnique({where: {id: price.id}}))?.modelId, model.id);
  assert.equal((await fixture.db.modelCoinPrice.findUnique({where: {id: coinPrice.id}}))?.modelId, model.id);
  assert.equal((await fixture.db.aiCall.findUnique({where: {id: call.id}}))?.model, model.key);
  await fixture.db.conversation.delete({where: {id: conversation.id}});
  await fixture.db.aiModelPrice.delete({where: {id: price.id}});
  await fixture.db.modelCoinPrice.delete({where: {id: coinPrice.id}});
  await fixture.db.aiCall.delete({where: {id: call.id}});
  await fixture.db.operationSetting.delete({where: {key: 'ai.taskModel.chat'}});
  await fixture.db.operationSetting.create({data: {key: 'ai.taskModel.chatSuggestions', group: 'billing', value: JSON.stringify(model.key), updatedBy: fixture.admin.id}});
  await assert.rejects(() => deleteAiModel(fixture.admin.id, model.id, {version: 1, reason: 'suggestion task reference guard'}), error => hasStatus(error, 409) && /任务模型设置/.test(String(error)));
  await fixture.db.operationSetting.delete({where: {key: 'ai.taskModel.chatSuggestions'}});
  const deletedModel = await deleteAiModel(fixture.admin.id, model.id, {version: 1, reason: 'unused model'});
  assert.equal(deletedModel.deleted, true);
  const deletedProvider = await deleteAiProvider(fixture.admin.id, provider.id, {version: 1, reason: 'unused provider'});
  assert.equal(deletedProvider.deleted, true);
  const audits = await fixture.db.adminAuditLog.findMany({where: {action: {in: ['DELETE_AI_MODEL', 'DELETE_AI_PROVIDER']}}, orderBy: {createdAt: 'asc'}});
  assert.deepEqual(audits.map(row => row.action), ['DELETE_AI_MODEL', 'DELETE_AI_PROVIDER']);
  const viewer = await fixture.db.user.create({data: {username: 'ai-delete-viewer', email: 'ai-delete-viewer@example.test', passwordHash: 'integration-only'}});
  await assert.rejects(() => deleteAiProvider(viewer.id, provider.id, {version: 1, reason: 'no permission'}), error => hasStatus(error, 403));
});
