import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from '../scripts/verify-baseline.mjs';

function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'khui-gate-'));
  const write=(file,text)=>{const dst=path.join(dir,file);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,text,'utf8')};
  write('package.json',JSON.stringify({dependencies:{next:'14',react:'18','@prisma/client':'5'},scripts:{build:'next build',test:'tsx tests/runner.ts'}}));
  write('package-lock.json','{}');
  write('LICENSE','MIT License\nCopyright (c) 2026 Authors');
  write('prisma/schema.prisma','datasource db {\n provider = "sqlite"\n url = env("DATABASE_URL")\n}');
  fs.mkdirSync(path.join(dir,'prisma/migrations'),{recursive:true});
  write('src/app/api/characters/route.ts','export const GET = 1;');
  write('src/lib/conversations/chat-stream.ts','export const streamMockResponse = 1;');
  write('src/app/api/coins/purchase/route.ts','export async function POST() {}');
  write('src/lib/payments/purchase-service.ts','function simulationAllowed() { return maySimulatePurchase(env) }');
  write('src/app/api/characters/[id]/comments/route.ts','export const GET = 1;');
  write('tests/runner.ts','export default true;');
  write('public/manifest.webmanifest',JSON.stringify({display:'standalone',icons:[{src:'/a.png'}]}));
  write('public/a.png','fake icon');
  try {return fn({dir,write})} finally {fs.rmSync(dir,{recursive:true,force:true})}
}

const prodEnv={JWT_SECRET:'a-really-long-production-unique-secret-123456789',OPENAI_API_KEY:'sk-a-real-looking-value-for-test-only'};

test('开发环境：代码齐全时可以继续开发，但暴露模拟回复/充值警告',()=>fixture(({dir})=>{
  const r=inspect(dir,'development',{});
  assert.equal(r.summary.blocked,0);
  assert.equal(r.checks.find(c=>c.id==='PAY-001').status,'WARN');
  assert.equal(r.checks.find(c=>c.id==='AI-002').status,'WARN');
}));

test('生产环境：没有密钥并保留模拟支付，必须阻断',()=>fixture(({dir})=>{
  const r=inspect(dir,'production',{});
  assert.ok(r.summary.blocked>=3);
  assert.equal(r.checks.find(c=>c.id==='SEC-001').status,'BLOCK');
  assert.equal(r.checks.find(c=>c.id==='AI-001').status,'BLOCK');
  assert.equal(r.checks.find(c=>c.id==='PAY-001').status,'BLOCK');
}));

test('生产环境：即使配置真密钥，只要还是模拟支付也阻断',()=>fixture(({dir})=>{
  const r=inspect(dir,'production',prodEnv);
  assert.equal(r.checks.find(c=>c.id==='SEC-001').status,'PASS');
  assert.equal(r.checks.find(c=>c.id==='AI-001').status,'PASS');
  assert.equal(r.checks.find(c=>c.id==='PAY-001').status,'BLOCK');
}));

test('生产环境：打开模拟购买开关是独立阻断项',()=>fixture(({dir})=>{
  const r=inspect(dir,'production',{...prodEnv,ALLOW_SIMULATED_PURCHASES:'true'});
  assert.equal(r.checks.find(c=>c.id==='PAY-002').status,'BLOCK');
}));

test('缺失 LICENSE 时必须阻断',()=>fixture(({dir})=>{
  fs.rmSync(path.join(dir,'LICENSE'));
  const r=inspect(dir,'development',{});
  assert.equal(r.checks.find(c=>c.id==='LEGAL-001').status,'BLOCK');
}));
