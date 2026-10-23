import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
async function source(path) { return readFile(new URL(path, root), 'utf8'); }

test('growth deletion routes expose DELETE with guarded services', async () => {
  const [missionRoute, giftRoute, missionService, giftService] = await Promise.all([
    source('apps/api/src/app/api/admin/growth/missions/[id]/route.ts'),
    source('apps/api/src/app/api/admin/growth/gifts/[id]/route.ts'),
    source('packages/backend/src/modules/missions/management-service.ts'),
    source('packages/backend/src/modules/gifts/catalog-service.ts'),
  ]);
  assert.match(missionRoute, /export async function DELETE/);
  assert.match(giftRoute, /export async function DELETE/);
  assert.match(missionService, /before\.isActive/);
  assert.match(missionService, /userMission\.count/);
  assert.match(giftService, /before\.isActive/);
  assert.match(giftService, /gift\.count/);
  assert.match(giftService, /giftType:before\.code/);
});

test('coin package deletion protects payment snapshots and requires inactive state', async () => {
  const [route, service] = await Promise.all([
    source('apps/api/src/app/api/admin/finance/packages/[id]/route.ts'),
    source('packages/backend/src/modules/coins/package-management.ts'),
  ]);
  assert.match(route, /export async function DELETE/);
  assert.match(service, /before\.isActive/);
  assert.match(service, /paymentOrder\.count/);
  assert.match(service, /DELETE_COIN_PACKAGE/);
});

test('site content restore sends an object to apiFetch', async () => {
  const sourceText = await source('apps/admin/src/components/site-content/site-content-management.tsx');
  assert.match(sourceText, /body:\{version:item\.version,reason\}/);
  assert.doesNotMatch(sourceText, /body:JSON\.stringify\(\{version:item\.version,reason\}\)/);
});
