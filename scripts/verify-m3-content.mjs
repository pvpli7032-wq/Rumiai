import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18789';
assert.equal(process.env.TEST_ISOLATED_DB, 'true', '须明确指定隔离测试环境');
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), '仅运行本机隔离测试');
const out = process.env.TEST_EVIDENCE_DIR || 'artifacts/m3-content';
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'file:./m3-content.db' } } });
const checks = [];
const mark = name => { checks.push(name); console.log('PASS', name); };
let browser;
try {
  await fs.mkdir(out, { recursive: true });
  const roles = await db.character.findMany({ where: { id: { startsWith: 'xingban-original-' } }, orderBy: { id: 'asc' }, select: { id: true, name: true, tagline: true, copyrightStatement: true, avatarUrl: true, isPublic: true, reviewStatus: true } });
  assert.equal(roles.length, 30);
  assert(roles.every(role => role.copyrightStatement?.trim() && role.isPublic && role.reviewStatus === 'APPROVED'));
  assert(roles.filter(role => !/^xingban-original-[0-5]$/.test(role.id)).every(role => role.copyrightStatement.includes('AI 辅助原创') && role.copyrightStatement.includes('商业发布前')));
  for (const role of roles) assert(role.avatarUrl && await fs.stat(`public${role.avatarUrl}`).then(info => info.isFile()));
  const topics = await db.circle.findMany({ where: { id: { startsWith: 'xingban-topic-' }, status: 'ACTIVE' }, select: { id: true, name: true, description: true, tags: true } });
  assert.equal(topics.length, 10);
  assert(topics.every(topic => topic.description.length >= 30 && topic.tags));
  const sourceRegister = await fs.readFile('docs/content/内容来源登记.md', 'utf8');
  assert(roles.every(role => sourceRegister.includes(role.name)));
  assert(topics.every(topic => sourceRegister.includes(topic.name)));
  mark('30 个原创角色、10 个圈子话题均已种入；角色授权说明、登记名录和项目 SVG 资源可核对');

  const roleApi = await fetch(`${base}/api/characters?sort=new`);
  assert.equal(roleApi.status, 200);
  const roleRows = await roleApi.json();
  assert(roleRows.some(role => role.id === 'xingban-original-6' && role.name === '许闻溪'));
  const topicApi = await fetch(`${base}/api/circles?search=${encodeURIComponent('星河街故事交换站')}`);
  assert.equal(topicApi.status, 200);
  const topicRows = await topicApi.json();
  assert.equal(topicRows.length, 1); assert.equal(topicRows[0].id, 'xingban-topic-0');
  mark('公开角色与圈子 API 可搜索返回种子内容');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pending = await db.character.create({ data: { name: 'UNREVIEWED_PUBLIC_SECRET', personality: 'test only', background: '', isPublic: true, reviewStatus: 'PENDING', chatCount: 999999 } });
  try {
    await page.goto(`${base}/zh/explore`);
    await page.getByText('许闻溪', { exact: true }).first().waitFor();
    assert.equal(await page.getByText(pending.name, { exact: true }).count(), 0);
    const sitemap = await fetch(`${base}/sitemaps/sitemap-characters-1.xml`);
    assert.equal(sitemap.status, 200);
    const xml = await sitemap.text();
    assert(!xml.includes(pending.id));
    assert(xml.includes('xingban-original-6'));
    mark('旧数据公开标记不能绕过审核：探索页与角色 sitemap 均排除未审核角色');
  } finally { await db.character.delete({ where: { id: pending.id } }); }
  await page.goto(`${base}/circles`);
  await page.getByRole('textbox', { name: /搜索圈子/ }).fill('星河街故事交换站');
  await page.getByRole('heading', { name: '星河街故事交换站', exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/content-seeds-mobile.png`, fullPage: true });
  mark('手机浏览器发现角色和搜索圈子内容可见，无溢出和前端错误');
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, checks, roles: roles.length, topics: topics.length, realAI: false }, null, 2));
} finally {
  if (browser) await browser.close();
  await db.$disconnect();
}
