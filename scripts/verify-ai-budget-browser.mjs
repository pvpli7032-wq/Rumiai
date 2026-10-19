// Production HTTP/browser verification using an owned local provider and a unique database.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, open, rm } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

const base = 'http://127.0.0.1:18795', providerBase = 'http://127.0.0.1:18796/v1';
const stamp = `${process.pid}-${Date.now()}`, file = `ai-budget-browser-${stamp}.db`;
const output = path.resolve('artifacts/ai-budget-browser', stamp);
await mkdir(output, { recursive: true });
const providerKey = randomBytes(24).toString('hex'), adminPassword = randomBytes(24).toString('hex');
const environment = {
  ...process.env, DATABASE_URL: `file:./${file}`, UPLOADS_DIRECTORY: path.join(output, 'uploads'),
  JWT_SECRET: randomBytes(48).toString('hex'), OPENAI_API_KEY: providerKey, OPENAI_BASE_URL: providerBase,
  AI_MODEL: 'budget-local-fixture', AI_FALLBACK_MODELS: '', AI_PRICE_MODEL: 'budget-local-fixture',
  AI_INPUT_PRICE_PER_MILLION: '2', AI_OUTPUT_PRICE_PER_MILLION: '4', AI_PRICE_CURRENCY: 'USD',
  AI_DAILY_COST_BUDGETS: '{"USD":{"site":100,"user":0.00028}}', AI_BUDGET_CIRCUIT_BREAKER: 'true',
  CHAT_DAILY_LIMIT: '200', CHAT_RATE_LIMIT: '100', DISABLE_MOCK_AI: 'true', ALLOW_SIMULATED_PURCHASES: 'false',
  EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', NEXT_DIST_DIR: '.next-build',
};
delete environment.RUST_LOG;
const database = path.resolve('prisma', file);
await createIsolatedDatabase(database);
const fixtureDb = new PrismaClient({ datasources: { db: { url: `file:${database.split(path.sep).join('/')}` } }, log: [] });
let admin;
try { admin = await fixtureDb.user.create({ data: { username: `budget_admin_${stamp}`, email: `budget-admin-${stamp}@example.invalid`, passwordHash: await bcrypt.hash(adminPassword, 10) } }); }
finally { await fixtureDb.$disconnect(); }
environment.PAYMENT_ADMIN_USER_IDS = admin.id;
let app, provider, browser, providerRequests = 0;
const checks = [], errors = [];
const pass = value => { checks.push(value); console.log('PASS', value); };
async function stopApp() {
  if (!app) return;
  const owned = app; app = undefined;
  if (owned.exitCode !== null || owned.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(owned.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else owned.kill('SIGTERM');
  for (let i = 0; i < 100 && owned.exitCode === null && owned.signalCode === null; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert(owned.exitCode !== null || owned.signalCode !== null, 'Owned production fixture must stop before restarting');
}
async function startApp() {
  const log = await open(path.join(output, 'server.log'), 'a');
  try { app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '18795'], { env: environment, stdio: ['ignore', log.fd, log.fd], windowsHide: true }); }
  finally { await log.close(); }
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw Error('Owned budget fixture exited before readiness');
    try { if ((await fetch(`${base}/api/ai/usage`)).status === 401) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Owned budget fixture did not become ready');
}
const request = (token, route, method = 'GET', body) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
async function fixture(label) {
  const response = await request(null, '/api/auth/register', 'POST', { username: `budget_${label}_${stamp}`, email: `budget-${label}-${stamp}@example.invalid`, password: randomBytes(24).toString('hex') });
  assert.equal(response.status, 201);
  const { token, user } = await response.json();
  const created = await request(token, '/api/characters', 'POST', { name: `预算验收 ${label}`, personality: '原创本地测试角色，只使用中文。', isPublic: false });
  assert.equal(created.status, 201); const { character } = await created.json();
  const opened = await request(token, '/api/conversations', 'POST', { characterId: character.id });
  assert.equal(opened.status, 201); const { conversation } = await opened.json();
  return { token, user, character, conversation };
}
try {
  provider = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || req.headers.authorization !== `Bearer ${providerKey}`) { res.writeHead(403); res.end(); return; }
    for await (const _chunk of req) { /* Discard synthetic prompts; only count provider requests. */ }
    providerRequests++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"这是本地预算验收回复。"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\n' + 'data: [DONE]\n\n');
  });
  provider.listen(18796, '127.0.0.1'); await once(provider, 'listening');
  await startApp();
  const a = await fixture('a');
  const first = await request(a.token, `/api/conversations/${a.conversation.id}/messages`, 'POST', { content: '本地合成问题' });
  assert.equal(first.status, 200); assert.match(await first.text(), /本地预算验收回复/);
  const usage = async token => (await request(token, '/api/ai/usage')).json();
  const history = async () => (await request(a.token, `/api/conversations/${a.conversation.id}/messages`)).json();
  const before = await history(), reply = before.findLast(message => message.role === 'ASSISTANT');
  const initialUsage = await usage(a.token);
  assert.equal(initialUsage.used, 1); assert.equal(initialUsage.calls[0].estimatedCost, 0.00028);
  assert.equal(providerRequests, 1);
  const denied = await request(a.token, `/api/conversations/${a.conversation.id}/messages`, 'POST', { content: '预算耗尽后不能保存' });
  assert.equal(denied.status, 429); assert(Number(denied.headers.get('Retry-After')) > 0);
  assert.match((await denied.json()).error, /成本预算/);
  const regeneration = await request(a.token, `/api/conversations/${a.conversation.id}/messages/${reply.id}/regenerate`, 'POST', {});
  assert.equal(regeneration.status, 429); assert.deepEqual(await history(), before);
  assert.equal((await usage(a.token)).used, 1); assert.equal(providerRequests, 1);
  pass('生产 HTTP/SSE 单次成本入库，预算达到阈值后发送/重生成 429，不增加调用或破坏旧回复');

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/login`); await page.evaluate(token => localStorage.setItem('xingban_token', token), a.token);
  await page.goto(`${base}/chat?character=${a.character.id}&conversation=${a.conversation.id}`);
  const input = page.locator('input[maxlength="5000"]'); await input.waitFor();
  await input.fill('预算拒绝后的草稿'); await page.locator('button[type="submit"]').click();
  await page.getByText('今日 AI 成本预算已达到上限，请在重置后继续。', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), '预算拒绝后的草稿');
  await page.waitForFunction(() => !document.querySelector('input[maxlength="5000"]')?.disabled);
  assert.equal(providerRequests, 1); assert.deepEqual(await history(), before);
  await page.screenshot({ path: path.join(output, 'blocked-chat.png') });
  pass('390px 真实聊天预算提示可见，输入恢复、草稿和旧回复保留，没有再次调用供应商');

  const b = await fixture('b');
  const other = await request(b.token, `/api/conversations/${b.conversation.id}/messages`, 'POST', { content: '另一账号正常调用' });
  assert.equal(other.status, 200); await other.text(); assert.equal(providerRequests, 2);
  const login = await request(null, '/api/auth/login', 'POST', { email: admin.email, password: adminPassword });
  assert.equal(login.status, 200); const { token: adminToken } = await login.json();
  const finance = await request(adminToken, '/api/admin/finance/report'); assert.equal(finance.status, 200);
  const report = await finance.json(); assert.equal(report.aiBudget.circuitBreaker, 'enabled'); assert.equal(report.aiBudget.alerts.filter(row => row.scope === 'user').length, 2);
  await page.evaluate(token => localStorage.setItem('xingban_token', token), adminToken); await page.goto(`${base}/admin/finance`);
  await page.getByText(/已开启自动熔断：/).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []); await page.screenshot({ path: path.join(output, 'finance-budget.png') });
  pass('每账号预算互相隔离，实际财务接口与 390px 页面显示熔断状态和预算告警');

  await stopApp(); await startApp();
  const restarted = await request(a.token, `/api/conversations/${a.conversation.id}/messages`, 'POST', { content: '重启后的拒绝' });
  assert.equal(restarted.status, 429); assert.equal(providerRequests, 2); assert.equal((await usage(a.token)).used, 1);
  pass('生产实例重启后成本阈值仍有效，不因进程内状态重置放行');

  await stopApp(); environment.AI_BUDGET_CIRCUIT_BREAKER = 'yes'; await startApp();
  const invalidMode = await request(a.token, `/api/conversations/${a.conversation.id}/messages`, 'POST', { content: '配置无效不能调用' });
  assert.equal(invalidMode.status, 503); assert.equal(invalidMode.headers.get('Retry-After'), null);
  assert.equal(providerRequests, 2); assert.equal((await usage(a.token)).used, 1);
  await page.reload(); await page.getByText('自动熔断开关无效，新调用将被拒绝，请检查服务端配置。', { exact: true }).waitFor();
  await page.getByText(/自动熔断配置无效，拒绝新调用。/).waitFor();
  pass('错误熔断开关返回 503，不消耗次数或调用供应商，实际后台明确显示配置错误');

  await stopApp(); environment.AI_BUDGET_CIRCUIT_BREAKER = 'true'; environment.AI_INPUT_PRICE_PER_MILLION = ''; await startApp();
  const noPrice = await request(a.token, `/api/conversations/${a.conversation.id}/messages`, 'POST', { content: '无模型单价不能调用' });
  assert.equal(noPrice.status, 503); assert.equal(providerRequests, 2); assert.equal((await usage(a.token)).used, 1);
  await page.reload(); await page.getByText('已开启自动熔断，但模型单价未配置或无效，新调用将被拒绝。', { exact: true }).waitFor();
  pass('显式开启熔断却缺少模型单价时立即拒绝，后台显示缺价，不先产生未知费用');

  await stopApp(); environment.AI_BUDGET_CIRCUIT_BREAKER = 'false'; environment.AI_INPUT_PRICE_PER_MILLION = '2'; await startApp();
  const disabled = await request(a.token, `/api/conversations/${a.conversation.id}/messages`, 'POST', { content: '显式关闭后的合成请求' });
  assert.equal(disabled.status, 200); await disabled.text(); assert.equal(providerRequests, 3);
  const profile = await request(a.token, '/api/users/me'); assert.equal((await profile.json()).coins, a.user.coins);
  pass('显式关闭熔断恢复原调用行为，整个流程不扣聊天金币或改变充值价格');
  const logs = await readFile(path.join(output, 'server.log'), 'utf8');
  assert(logs.includes('ai_budget_alert') && logs.includes('ai_budget_blocked'));
  for (const sensitive of [providerKey, environment.JWT_SECRET, adminPassword, '预算拒绝后的草稿']) assert(!logs.includes(sensitive));
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks, providerRequests, realProvider: false, errors, database: file }, null, 2));
} finally {
  await browser?.close(); await stopApp();
  provider?.closeAllConnections();
  if (provider) await new Promise(resolve => provider.close(resolve));
  await rm(path.join(output, 'server.log'), {force:true}); await rm(path.join(output, 'migration.log'), {force:true});
}
