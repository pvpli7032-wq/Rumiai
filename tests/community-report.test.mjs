import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `community-report-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const migrationEnv = {...process.env}; delete migrationEnv.RUST_LOG;
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env: migrationEnv, encoding: 'utf8', windowsHide: true});
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
const {db} = await import('../src/lib/db.ts');
const {listOwnReports, submitReport, CommunityReportError} = await import('../src/lib/community/report-service.ts');
const {listModerationReports, listCommunityAppeals, listModerationAudit, ModerationReadError} = await import('../src/lib/community/moderation-read-service.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {GET: getReports, POST: postReport} = await import('../src/app/api/reports/route.ts');
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

const user = name => db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic-only'}});

test('report filing validates targets and updates the reporter-target pair instead of stacking', async () => {
  const reporter = await user('reporter');
  const target = await user('target');
  const first = await submitReport(reporter.id, {target_type: 'user', target_id: target.id, category: 'copyright', workTitle: '原作名', relationship: 'owner', sourceLink: 'https://example.invalid/source'});
  assert.equal(first.success, true);
  assert.equal(first.updated, false);
  const second = await submitReport(reporter.id, {targetType: 'USER', targetId: target.id, category: 'spam', details: '请复核该账号的公开行为。'});
  assert.equal(second.report.id, first.report.id);
  assert.equal(second.updated, true);
  assert.equal(await db.report.count({where: {reporterId: reporter.id, targetType: 'USER', targetId: target.id}}), 1);
  assert.equal((await listOwnReports(reporter.id)).length, 1);
  assert.equal((await listOwnReports(target.id)).length, 0);

  const concurrentTarget = await user('concurrenttarget');
  const concurrent = await Promise.all([
    submitReport(reporter.id, {targetType: 'USER', targetId: concurrentTarget.id, category: 'spam'}),
    submitReport(reporter.id, {targetType: 'USER', targetId: concurrentTarget.id, category: 'abuse'}),
  ]);
  assert.deepEqual(concurrent.map(result => result.updated).sort(), [false, true]);
  assert.equal(await db.report.count({where: {reporterId: reporter.id, targetType: 'USER', targetId: concurrentTarget.id}}), 1);
});

test('invalid and nonexistent reports fail with domain statuses and write nothing', async () => {
  const reporter = await user('invalidreporter');
  const before = await db.report.count({where: {reporterId: reporter.id}});
  await assert.rejects(() => submitReport(reporter.id, null), error => error instanceof CommunityReportError && error.status === 400);
  await assert.rejects(() => submitReport(reporter.id, {targetType: 'PLANET', targetId: 'x', category: 'spam'}), error => error.status === 400);
  await assert.rejects(() => submitReport(reporter.id, {targetType: 'USER', targetId: 'missing-user', category: 'spam'}), error => error.status === 404);
  await assert.rejects(() => submitReport(reporter.id, {targetType: 'USER', targetId: 'missing-user', category: 'other'}), error => error.status === 400);
  assert.equal(await db.report.count({where: {reporterId: reporter.id}}), before);
});

test('report HTTP adapter authenticates and maps create/update status and private listing', async () => {
  const reporter = await user('route_reporter');
  const target = await user('route_target');
  const token = await signToken({userId: reporter.id, email: reporter.email, tokenVersion: reporter.tokenVersion});
  const post = () => new Request('http://local.test/api/reports', {
    method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({targetType: 'USER', targetId: target.id, category: 'spam'}),
  });
  assert.equal((await postReport(new Request('http://local.test/api/reports', {method: 'POST'}))).status, 401);
  const created = await postReport(post()); assert.equal(created.status, 201);
  const updated = await postReport(post()); assert.equal(updated.status, 200);
  const own = await getReports(new Request('http://local.test/api/reports', {headers: {Authorization: `Bearer ${token}`}}));
  assert.equal(own.status, 200);
  assert.equal((await own.json()).length, 1);
});

test('moderation queue reads and related target projections stay in the community domain', async () => {
  const moderator = await user('queue_moderator'), target = await user('queue_target');
  const report = await db.report.create({data: {reporterId: moderator.id, targetType: 'USER', targetId: target.id, category: 'spam', details: '公开内容合成举报'}});
  const appeal = await db.communityAppeal.create({data: {userId: target.id, reason: '合成申诉'}});
  await db.moderationAction.create({data: {actorId: moderator.id, targetType: 'USER', targetId: target.id, action: 'BAN', reason: '合成审核记录'}});
  const reports = await listModerationReports('OPEN', 30);
  assert.equal(reports.find(row => row.id === report.id)?.target?.username, target.username);
  assert.equal((await listCommunityAppeals('OPEN')).find(row => row.id === appeal.id)?.user.username, target.username);
  assert.equal((await listModerationAudit()).some(row => row.actor.id === moderator.id), true);
  await assert.rejects(() => listModerationReports('BROKEN', 30), error => error instanceof ModerationReadError && error.status === 400);
  await assert.rejects(() => listCommunityAppeals('BROKEN'), error => error instanceof ModerationReadError && error.status === 400);
});
