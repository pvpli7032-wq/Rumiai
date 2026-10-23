import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = relative => readFileSync(path.join(root, relative.replaceAll('/', path.sep)), 'utf8');

test('AI lifecycle patch exposes DELETE routes and dependency-safe service guards', () => {
  const providerRoute = read('apps/api/src/app/api/admin/ai/providers/[id]/route.ts');
  const modelRoute = read('apps/api/src/app/api/admin/ai/models/[id]/route.ts');
  const providers = read('packages/backend/src/modules/ai/providers/management-service.ts');
  const models = read('packages/backend/src/modules/ai/models/management-service.ts');
  assert.match(providerRoute, /export async function DELETE/);
  assert.match(modelRoute, /export async function DELETE/);
  assert.match(providers, /providerReferences/);
  assert.match(providers, /activeModels/);
  assert.match(providers, /请先停用供应商/);
  assert.match(models, /characterBindings/);
  assert.match(models, /conversationBindings/);
  assert.match(models, /modelPrices/);
  assert.match(models, /coinPrices/);
  assert.match(models, /aiCalls/);
  assert.match(models, /taskSettings/);
  assert.match(models, /请先停用模型/);
  assert.match(models, /默认模型不能直接删除/);
  assert.match(models, /备用模型不能直接删除/);
});

test('AI admin forms whitelist edit payloads and expose reference-aware delete actions', () => {
  const providerUi = read('apps/admin/src/components/ai-providers/ai-provider-management.tsx');
  const modelUi = read('apps/admin/src/components/ai-models/ai-model-management.tsx');
  assert.match(providerUi, /method:'DELETE'/);
  assert.match(providerUi, /provider\.references/);
  assert.match(providerUi, /id:provider\.id,name:provider\.name/);
  assert.doesNotMatch(providerUi, /setDraft\(\{\.\.\.provider/);
  assert.match(providerUi, /DetailDrawer/);
  assert.match(providerUi, /<Dialog/);
  assert.doesNotMatch(providerUi, /window\.prompt/);
  assert.match(providerUi, /draftBaseline/);
  assert.match(providerUi, /放弃未保存修改/);
  assert.match(modelUi, /method:'DELETE'/);
  assert.match(modelUi, /model\.references/);
  assert.match(modelUi, /id:model\.id,key:model\.key/);
  assert.doesNotMatch(modelUi, /setDraft\(\{\.\.\.model/);
  assert.match(modelUi, /DetailDrawer/);
  assert.match(modelUi, /<Dialog/);
  assert.doesNotMatch(modelUi, /window\.prompt/);
  assert.match(modelUi, /draftBaseline/);
  assert.match(modelUi, /放弃未保存修改/);
});
