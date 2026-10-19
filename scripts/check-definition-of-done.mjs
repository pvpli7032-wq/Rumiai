/**
 * 计划书第 7 章「完成定义」的可执行检查。每一项都写明允许的例外及其理由，
 * 免得靠人肉 grep 得出「差不多干净了」的结论。
 *
 * 用法：node scripts/check-definition-of-done.mjs
 * 任一硬指标不通过时退出码为 1。
 */
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const notes = [];

const rel = file => path.relative(root, file).replaceAll('\\', '/');
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    // 只走人工维护的源码与文档。构建产物、测试证据、本地数据库与上传是生成物，
    // 里面出现旧品牌名或旧路径不代表源码残留（此前 artifacts/planning 就误报过一次）。
    if (['node_modules', '.next', '.next-build', '.next-validation-build', '.git', '.temp', 'artifacts', 'uploads'].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const sourceFiles = walk(path.join(root, 'src'));
const read = file => readFileSync(file, 'utf8');

/** 1. 品牌色：组件里不允许出现十六进制品牌色，令牌定义与后台默认值除外。 */
const BRAND_HEX = /#(ee4036|faaf40|ff1300|ffa202|f2572b|ff2f00)/i;
const brandAllowed = new Set(['src/lib/site-content/brand-defaults.ts']);
const brandHits = sourceFiles
  .filter(file => /\.(tsx|ts)$/.test(file))
  .filter(file => !brandAllowed.has(rel(file)))
  .filter(file => BRAND_HEX.test(read(file)))
  .map(rel);
if (brandHits.length) failures.push(`品牌色硬编码：${brandHits.join(', ')}`);
else notes.push('品牌色：组件中 0 处，仅令牌与 brand-defaults.ts 定义');

/** 2. 旧字体类名。 */
const fontHits = sourceFiles.filter(file => /font-athiti/i.test(read(file))).map(rel);
if (fontHits.length) failures.push(`旧字体类名：${fontHits.join(', ')}`);
else notes.push('旧字体类名：0 处');

/** 3. 泰语字符：只允许出现在语言词典里。 */
const THAI = /[\u0E00-\u0E7F]/;
const thaiAllowed = file => rel(file).startsWith('src/lib/i18n/dictionaries/') || rel(file) === 'src/lib/i18n.ts';
const thaiHits = sourceFiles.filter(file => THAI.test(read(file)) && !thaiAllowed(file)).map(rel);
if (thaiHits.length) failures.push(`词典之外的泰语：${thaiHits.join(', ')}`);
else notes.push('泰语字符：仅存在于 i18n 词典（含内联的 th 文案）');

/** 4. 文案层已收口。 */
const zhTextHits = sourceFiles.filter(file => /zhText/.test(read(file))).map(rel);
if (zhTextHits.length) failures.push(`zhText 残留：${zhTextHits.join(', ')}`);
if (existsSync(path.join(root, 'src/lib/zh-text.ts')) || existsSync(path.join(root, 'app-zh.json'))) failures.push('文案中间层文件仍存在');
if (!zhTextHits.length) notes.push('文案层：无 zhText，中间层文件已删除');

/** 5. 管理接口全部在 /api/admin 下，旧前缀不得再有任何路由或客户端调用。 */
const legacyPrefixes = ['/api/finance', '/api/moderation', '/api/accounts/management', '/api/characters/management', '/api/circles/management'];
const legacyHits = [];
for (const file of sourceFiles) {
  const text = read(file);
  if (rel(file) === 'src/lib/operations/maintenance-routing.ts') continue;
  for (const prefix of legacyPrefixes) if (text.includes(prefix)) legacyHits.push(`${rel(file)}:${prefix}`);
}
if (legacyHits.length) failures.push(`旧管理前缀仍有引用：${legacyHits.join(', ')}`);
else notes.push('旧管理前缀：源码中 0 处引用');

/** 6. 兼容重写只剩 /uploads 这一条真实映射。 */
const nextConfig = read(path.join(root, 'next.config.mjs'));
if (!/source: '\/uploads\/:name'/.test(nextConfig)) failures.push('next.config.mjs 缺少 /uploads 重写');
if (/\/api\/finance|\/api\/moderation/.test(nextConfig)) failures.push('next.config.mjs 仍有管理接口兼容重写');
if (!/api\/finance/.test(nextConfig)) notes.push('兼容重写：已全部移除，仅保留 /uploads');

/** 7. 前台不得引用后台组件。 */
const appFiles = walk(path.join(root, 'src/app')).concat(walk(path.join(root, 'src/components')));
const adminImports = appFiles
  .filter(file => /\.(tsx|ts)$/.test(file))
  .filter(file => !rel(file).startsWith('src/components/admin/') && !rel(file).startsWith('src/app/(admin)/'))
  .filter(file => /@\/components\/admin\//.test(read(file)))
  .map(rel);
if (adminImports.length) failures.push(`前台引用了后台组件：${adminImports.join(', ')}`);
else notes.push('前后台隔离：前台 0 处引用后台组件');

/** 8. khui 命名：白名单之外不允许出现。 */
const khuiAllow = file => {
  const p = rel(file);
  return p === 'LICENSE' || p === 'THIRD_PARTY_NOTICES.md'
    // 部署名与运维文档：决策 D4 明确保留。
    || p.startsWith('prisma/migrations/') || p.startsWith('deploy/')
    || p.startsWith('docs/')
    // 旧站拉取的语言词典，键名沿用上游，替换键名会把 PULLED_FIELDS 映射一起弄坏。
    || p.startsWith('src/lib/i18n/dictionaries/') || p === 'src/lib/i18n.ts'
    // 下面三处是「提到 khui 是为了禁掉它」，不是残留。
    || p === 'scripts/check-definition-of-done.mjs' || p === 'scripts/verify-baseline.mjs'
    || p === 'src/lib/auth.ts'
    // 草稿键迁移：旧键必须存在一次才能搬走旧草稿。
    || p === 'src/app/(app)/creator/creator-form.tsx'
    // 上游仓库联系链接，属于来源信息。
    || p.startsWith('.github/') || p.startsWith('tests/');
};
const tracked = walk(root).filter(file => /\.(ts|tsx|js|mjs|cjs|json|md|yml|service|conf)$/.test(file) && !rel(file).startsWith('.workbuddy/'));
const khuiHits = tracked.filter(file => /khui/i.test(read(file)) && !khuiAllow(file)).map(rel);
if (khuiHits.length) failures.push(`khui 命名残留：${khuiHits.join(', ')}`);
else notes.push('khui 命名：白名单外 0 处（部署名、历史迁移、旧站拉取词典保留）');

/**
 * 9. 文档不是门禁项。
 *
 * 曾经在这里检查 ARCHITECTURE.md / README.md / docs/待完成清单.md 是否存在，但文档
 * 去留由负责人决定（2026-10-20 决定删除根目录说明文档与历史清单），拿文件存在性当
 * 完成定义只会逼人留一份没人维护的空壳。这里只保留一条可执行的事实：规划书基线文档
 * 必须在仓库内，因为实施范围以它为准。
 */
if (!existsSync(path.join(root, 'docs/planning/角色关系连续剧产品与实施规划书_完整详细版_V1.0.docx'))) {
  failures.push('缺少规划书基线文档：docs/planning/角色关系连续剧产品与实施规划书_完整详细版_V1.0.docx');
}

console.log('完成定义检查');
for (const note of notes) console.log(`  ok   ${note}`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
console.log(failures.length ? `\n不通过：${failures.length} 项` : '\n全部通过');
if (failures.length) process.exitCode = 1;
