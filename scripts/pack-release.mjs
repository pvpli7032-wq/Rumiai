/**
 * 本地打包发布目录：把当前工作区整理成一份可直接上传服务器解压的源码包。
 *
 * 排除清单与 deploy/baota/README.md 的「源码上传不包含」一致：
 * env、数据库及伴随文件、备份、用户上传、Windows 依赖、构建缓存、测试产物、日志。
 * 保留锁文件、完整迁移、静态资源、许可证及第三方声明。
 *
 * 用法：node scripts/pack-release.mjs <标签> [--tar]
 *   <标签>  1–80 位字母、数字、下划线和连字符，建议沿用发布命名 commercial-YYYYMMDD-<批次>。
 *   --tar   打包后在 artifacts/release-packs/ 下生成 <标签>.tar.gz（系统无 tar 时报错）。
 *
 * 输出 JSON 摘要（文件数、字节数、迁移数、检查结果）。打包目录已存在时拒绝，避免覆盖旧包。
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const label = process.argv[2];
const wantTar = process.argv.includes('--tar');
if (process.argv.length > 4 || !label || !/^[A-Za-z0-9_-]{1,80}$/.test(label)) {
  console.error('用法：node scripts/pack-release.mjs <标签> [--tar]（标签仅支持 1–80 位字母、数字、下划线和连字符）');
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(packRelease(label, {tar: wantTar})));
  } catch (error) {
    console.error(`打包未完成：${error.message}`);
    process.exitCode = 1;
  }
}

function packRelease(label, options) {
  const root = process.cwd();
  const staging = path.join(root, 'artifacts', 'release-packs', label);
  if (existsSync(staging)) throw Error(`打包目录已存在，拒绝覆盖：${staging}（如需重打，先人工删除旧目录）`);

  const migrationsDir = path.join(root, 'prisma', 'migrations');
  const expectedMigrations = readdirSync(migrationsDir, {withFileTypes: true}).filter(entry => entry.isDirectory()).length;

  let files = 0, bytes = 0;
  mkdirSync(staging, {recursive: true});
  copyTree(root, staging);

  /** 排除规则：目录按相对路径匹配，文件按名称匹配。 */
  function excluded(relative, name, isDirectory) {
    if (isDirectory) {
      const top = relative === '' ? name : relative.split('/')[0];
      // 顶层构建目录按 .next 前缀整体排除：.next、.next-build，以及
      // 验证脚本用 ISOLATED_BUILD_DIR 生成的 .next-<用途> 变体。
      if (relative === '' && (['.git', 'node_modules', 'artifacts', '.temp'].includes(name) || /^\.next/.test(name))) return true;
      if (['public/uploads', 'prisma/.local', 'prisma/backups'].includes(`${relative}/${name}`)) return true;
      return false;
    }
    if (/^\.env(\..+)?$/.test(name) || name === 'app.env') return true;
    if (/\.(db|db-wal|db-shm|db-journal|log)$/.test(name)) return true;
    return name === '线上测试文档资料.txt';
  }

  function copyTree(source, target, relative = '') {
    for (const entry of readdirSync(source, {withFileTypes: true})) {
      if (excluded(relative, entry.name, entry.isDirectory())) continue;
      const from = path.join(source, entry.name);
      const to = path.join(target, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(to);
        copyTree(from, to, relative === '' ? entry.name : `${relative}/${entry.name}`);
      } else if (entry.isFile()) {
        copyFileSync(from, to);
        files += 1;
        bytes += statSync(from).size;
      }
    }
  }

  // 打包结果自检：入口文件齐全、迁移完整、排除物确实没混进去。
  const required = ['package.json', 'package-lock.json', 'next.config.mjs', 'prisma/schema.prisma',
    'scripts/start-production.mjs', 'scripts/check-release.mjs', 'deploy/baota/ecosystem.config.js',
    path.join('prisma', 'migrations', '20261020120000_story_run_contract', 'migration.sql')];
  const missing = required.filter(entry => !existsSync(path.join(staging, entry)));
  if (missing.length) throw Error(`打包缺关键文件：${missing.join(', ')}`);
  const packagedMigrations = readdirSync(path.join(staging, 'prisma', 'migrations'), {withFileTypes: true}).filter(entry => entry.isDirectory()).length;
  if (packagedMigrations !== expectedMigrations) throw Error(`迁移数量不符：仓库 ${expectedMigrations}，包内 ${packagedMigrations}`);
  const forbidden = ['.env', 'node_modules', 'public/uploads', 'artifacts'];
  const leaked = forbidden.filter(entry => existsSync(path.join(staging, entry)));
  if (leaked.length) throw Error(`排除物混入打包：${leaked.join(', ')}`);
  const buildDirs = readdirSync(staging, {withFileTypes: true}).filter(entry => entry.isDirectory() && /^\.next/.test(entry.name)).map(entry => entry.name);
  if (buildDirs.length) throw Error(`构建目录混入打包：${buildDirs.join(', ')}`);
  const dbLeak = readdirSync(path.join(staging, 'prisma')).filter(entry => /\.db(-wal|-shm|-journal)?$/.test(entry));
  if (dbLeak.length) throw Error(`prisma/ 下混入数据库文件：${dbLeak.join(', ')}`);

  let tar = null;
  if (options.tar) {
    const packDir = path.join(root, 'artifacts', 'release-packs');
    // 用相对路径调 tar：Windows 的 GNU tar 会把 "C:\..." 当远程主机名（Cannot connect to C:）。
    const result = spawnSync('tar', ['-czf', `${label}.tar.gz`, label], {cwd: packDir, encoding: 'utf8', windowsHide: true});
    const archive = path.join(packDir, `${label}.tar.gz`);
    if (result.status !== 0 || !existsSync(archive)) {
      throw Error(`tar 打包失败（可去掉 --tar 只保留目录，再手工压缩）：${(result.stderr || result.error?.message || '').trim()}`);
    }
    tar = {archive, bytes: statSync(archive).size};
  }

  return {label, staging, files, bytes, migrations: packagedMigrations, tar, checks: 'ok'};
}
