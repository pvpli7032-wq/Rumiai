#!/usr/bin/env node
/**
 * Khui AI baseline and release-gate audit.
 * Run from repo root: node scripts/verify-baseline.mjs --root . --mode development
 * Zero third-party dependencies; no network calls; never prints secrets.
 * This is a static readiness check, NOT a vulnerability scanner or passing E2E proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function read(root, file) {
  try { return fs.readFileSync(path.join(root, file), 'utf8'); }
  catch { return null; }
}
function exists(root, file) { return fs.existsSync(path.join(root, file)); }
function parseDotEnv(source) {
  const result = {};
  for (const raw of (source ?? '').split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[m[1]] = value;
  }
  return result;
}
const badSecret = (s) => !s || s.length < 32 || /^(your-|change-me|replace-me|test-|example|sk-xxx)/i.test(s) || s === 'khuiai-secret-jwt-key-2026';
const badKey = (s) => !s || /^(your-|change-me|replace-me|test-|example|sk-xxx)/i.test(s);

/** @returns {{mode:string, root:string, checks:Array, summary:object}} */
export function inspect(root, mode = 'development', env = process.env) {
  if (!['development', 'production'].includes(mode)) throw new Error('mode must be development or production');
  const checks = [];
  const add = (id, status, message, evidence) => checks.push({ id, status, message, ...(evidence ? { evidence } : {}) });
  const prod = mode === 'production';
  const pkgSource = read(root, 'package.json');
  let pkg = null;
  try { pkg = JSON.parse(pkgSource); } catch { /* handled below */ }
  if (!pkg) {
    add('REPO-001', 'BLOCK', '未找到有效的 package.json，不能认为源码完整。', 'package.json');
  } else {
    const deps = pkg.dependencies ?? {};
    const valid = ['next', 'react', '@prisma/client'].every(k => Boolean(deps[k]));
    add('REPO-001', valid ? 'PASS' : 'BLOCK', valid ? '核心 Next/React/Prisma 依赖声明存在。' : '缺少关键项目依赖声明。', 'package.json');
    add('REPO-002', pkg.scripts?.build && pkg.scripts?.test ? 'PASS' : 'BLOCK', pkg.scripts?.build && pkg.scripts?.test ? '存在构建与测试命令。' : '缺少 build 或 test 命令。', 'package.json');
  }
  add('REPO-003', exists(root, 'package-lock.json') ? 'PASS' : 'WARN', '检查依赖锁定文件（需要完整源码且 npm ci 成功验证）。', 'package-lock.json');
  const lic = read(root, 'LICENSE');
  add('LEGAL-001', lic?.includes('MIT License') ? 'PASS' : 'BLOCK', lic?.includes('MIT License') ? 'MIT 许可文件存在；素材、品牌授权仍需单独检查。' : '未发现预期的 MIT LICENSE，必须暂停二开授权判断。', 'LICENSE');

  const schema = read(root, 'prisma/schema.prisma');
  const driver = schema?.match(/datasource\s+db\s*\{[^}]*?provider\s*=\s*"([^"]+)"/s)?.[1];
  if (!driver) add('DATA-001','BLOCK','未读到 Prisma 数据库 provider。','prisma/schema.prisma');
  else if (driver === 'sqlite') add('DATA-001',prod?'WARN':'PASS','使用 SQLite；小规模单机可以验证，正式规模化前评估 PostgreSQL 迁移。','prisma/schema.prisma');
  else add('DATA-001','PASS',`数据库 provider：${driver}；仍需执行迁移和并发测试。`,'prisma/schema.prisma');
  add('DATA-002',exists(root,'prisma/migrations')?'PASS':'BLOCK','检查 Prisma migrations 目录；尚需实际执行 migrate deploy。','prisma/migrations');

  for (const [id, filename] of [
    ['APP-001','src/app/api/characters/route.ts'],
    ['APP-002','src/lib/conversations/chat-stream.ts'],
    ['APP-003','src/app/api/coins/purchase/route.ts'],
    ['APP-004','src/app/api/characters/[id]/comments/route.ts'],
    ['APP-005','tests/runner.ts'],
  ]) add(id, exists(root,filename)?'PASS':'BLOCK',exists(root,filename)?'基础业务源文件存在，尚需动态测试。':'缺少关键业务源文件。',filename);

  let manifest = null;
  try { manifest = JSON.parse(read(root, 'public/manifest.webmanifest')); } catch { /* handled below */ }
  add('PWA-001', manifest?.display === 'standalone' ? 'PASS' : 'WARN', '检查 PWA standalone 清单；需真机验证图标/导航/键盘。','public/manifest.webmanifest');
  if (manifest?.icons?.length) {
    const bad = manifest.icons.map(x => x.src).filter(src=>!src || !exists(root,path.join('public',src.replace(/^\//,''))));
    add('PWA-002',bad.length?'WARN':'PASS',bad.length?'PWA 图标文件缺失或路径不匹配。':'PWA 清单引用的本地图标存在。','public/manifest.webmanifest');
  }

  const configured = { ...parseDotEnv(read(root, '.env')), ...parseDotEnv(read(root, '.env.production.local')), ...env };
  const jwt = configured.JWT_SECRET;
  add('SEC-001', prod && badSecret(jwt) ? 'BLOCK' : badSecret(jwt) ? 'WARN' : 'PASS',prod && badSecret(jwt) ? '生产 JWT_SECRET 缺失、过短或是示例密钥。':'JWT 密钥准备度检查（密钥内容不会输出）。','JWT_SECRET');
  const aiKey = configured.OPENAI_API_KEY;
  add('AI-001',prod && badKey(aiKey)?'BLOCK':badKey(aiKey)?'WARN':'PASS',prod&&badKey(aiKey)?'生产模型 API Key 未配置；当前安全策略将返回 503，不允许模拟回复。':'模型 Key 配置检查；仍需发起真实 SSE 调用测试。','OPENAI_API_KEY');
  const stream = read(root,'src/lib/conversations/chat-stream.ts');
  if (stream?.includes('streamMockResponse')) add('AI-002','WARN','存在模拟 AI 回复逻辑：需要确保生产不能将其当成真实成功回复。','src/lib/conversations/chat-stream.ts');
  const coinRoute = read(root,'src/app/api/coins/purchase/route.ts');
  if (coinRoute?.includes('simulationAllowed') || coinRoute?.includes('maySimulatePurchase') || coinRoute?.includes('credits coins without taking payment')) {
    add('PAY-001',prod?'BLOCK':'WARN',prod?'购买接口仍是模拟充值；无真实支付回调验收时禁止生产上线。':'当前商城接口使用模拟充值，测试仅限隔离环境。','src/app/api/coins/purchase/route.ts');
  } else if (coinRoute) {
    add('PAY-001','WARN','购买接口并非已知模拟版本；必须另行审核支付回调、账本和幂等性。','src/app/api/coins/purchase/route.ts');
  }
  add('PAY-002',configured.ALLOW_SIMULATED_PURCHASES === 'true' && prod?'BLOCK':'PASS',configured.ALLOW_SIMULATED_PURCHASES === 'true' && prod?'生产配置仍携带模拟购买开关，需关闭；当前路由已强制阻断模拟充值。':'生产模拟购买开关未被明确启用。','ALLOW_SIMULATED_PURCHASES');
  const limiter = read(root,'src/lib/rate-limit.ts');
  if (limiter?.includes('new Map<')) add('SEC-002','WARN','限流状态使用单进程 Map；多实例部署须改为共享存储。','src/lib/rate-limit.ts');
  const passed = checks.filter(x=>x.status==='PASS').length;
  const blocked = checks.filter(x=>x.status==='BLOCK').length;
  const warned = checks.filter(x=>x.status==='WARN').length;
  return {mode,root:path.resolve(root),checks,summary:{passed,blocked,warned,ready:blocked===0}};
}

function printResult(report) {
  console.log(`\nKhui AI 基线检查 · ${report.mode}\n仓库：${report.root}\n`);
  for (const c of report.checks) console.log(`[${c.status.padEnd(5)}] ${c.id} ${c.message} (${c.evidence})`);
  const s=report.summary;
  console.log(`\n汇总：PASS ${s.passed} | WARN ${s.warned} | BLOCK ${s.blocked}`);
  console.log(s.ready?'静态检查无 BLOCK；仍须通过真实构建、E2E、安全及支付验收。':'存在阻断项；禁止宣布可生产上线。');
}

async function main() {
  const args=process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: node scripts/verify-baseline.mjs --root <repo-root> --mode development|production [--json <output.json>]'); return; }
  const value=(name, fallback)=>{ const i=args.indexOf(name);return i>=0?args[i+1]:fallback; };
  const root=path.resolve(value('--root','.'));
  const mode=value('--mode', process.env.NODE_ENV==='production'?'production':'development');
  const report=inspect(root,mode);
  printResult(report);
  const output=value('--json',null);
  if(output) fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2),'utf8');
  process.exitCode=report.summary.ready?0:2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err=>{console.error(`检查出错：${err.message}`);process.exitCode=3;});
}
