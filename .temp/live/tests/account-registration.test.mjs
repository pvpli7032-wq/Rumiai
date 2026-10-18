import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `account-registration-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const migrationEnv = {...process.env}; delete migrationEnv.RUST_LOG;
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env: migrationEnv, encoding: 'utf8', windowsHide: true});
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);

const {db} = await import('../src/lib/db.ts');
const {registerAccount, AccountRegistrationError} = await import('../src/lib/accounts/registration-service.ts');
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

test('registration normalizes identity, allocates distinct handles, and creates starter balance', async () => {
  const first = await registerAccount({email: '  Name@Example.Invalid ', name: '相同昵称', password: 'Local123'});
  const second = await registerAccount({email: 'name2@example.invalid', displayName: '相同昵称', password: 'Local123'});
  assert.equal(first.email, 'name@example.invalid');
  assert.equal(first.username, 'name');
  assert.equal(second.username, 'name2');
  assert.equal(first.displayName, second.displayName);
  assert.equal(first.coins, 100);
  assert.equal(first.tier, 'ROOKIE');
});

test('registration rejects invalid and duplicate credentials without creating users', async () => {
  const before = await db.user.count();
  for (const input of [null, {}, {email: 'bad@example.invalid', username: 'bad', password: '12345'}, {email: 'bad@example.invalid', username: 'bad', password: '中文'.repeat(13)}]) {
    await assert.rejects(() => registerAccount(input), error => error instanceof AccountRegistrationError && error.status === 400);
  }
  await assert.rejects(() => registerAccount({email: 'NAME@example.invalid', username: 'another', password: 'Local123'}), error => error.status === 409);
  await assert.rejects(() => registerAccount({email: 'other@example.invalid', username: 'name', password: 'Local123'}), error => error.status === 409);
  assert.equal(await db.user.count(), before);
});

test('disabled compliance defaults preserve registration and configured policy requires versioned confirmations atomically', async () => {
  const defaults=await db.compliancePolicy.findUnique({where:{id:'primary'}});
  assert.equal(defaults.ageGateEnabled,false);
  const defaultUser=await registerAccount({email:'consent-default@example.invalid',username:'consent-default',password:'Local123'});
  assert.equal(await db.userConsent.count({where:{userId:defaultUser.id}}),0);
  const configuredBaseline=await db.user.count();
  await db.compliancePolicy.update({where:{id:'primary'},data:{ageGateEnabled:true,minimumAge:18,agePolicyVersion:'age-2026-01',termsVersion:'terms-2026-01',privacyVersion:'privacy-2026-01'}});
  await assert.rejects(()=>registerAccount({email:'consent-missing@example.invalid',username:'consent-missing',password:'Local123'}),error=>error.status===400);
  assert.equal(await db.user.count(),configuredBaseline);
  const user=await registerAccount({email:'consent-valid@example.invalid',username:'consent-valid',password:'Local123',consents:{ageConfirmed:true,termsAccepted:true,privacyAccepted:true}});
  const consents=await db.userConsent.findMany({where:{userId:user.id},orderBy:{policyType:'asc'}});
  assert.deepEqual(consents.map(row=>[row.policyType,row.policyVersion,row.source]),[['AGE','age-2026-01','REGISTER'],['PRIVACY','privacy-2026-01','REGISTER'],['TERMS','terms-2026-01','REGISTER']]);
});
