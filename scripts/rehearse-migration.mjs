/**
 * 副本迁移演练：对一份生产库副本执行待应用迁移，全程不触碰生产写库。
 *
 * 对应 HANDOFF.md 第 7 节第 4 步「在副本上先跑迁移」的可脚本化版本。
 *
 * 用法：
 *   1. node scripts/rehearse-migration.mjs /abs/path/to/copy.db
 *      演练「生产副本升级」。副本必须来自 state:backup 产物（单文件 database.db，
 *      无 -wal/-shm/-journal 伴随文件）。脚本把它复制到 prisma/.local/ 下的演练目录，
 *      对副本应用 prisma/migrations 中所有尚未记录的迁移，然后核对。
 *   2. node scripts/rehearse-migration.mjs（无参数，本地自证）
 *      先按「除最新一条外的全部迁移」构造 45 条基线库，再演练应用最新一条，
 *      等价复现生产 45→46 的升级路径。零风险，可随时重跑。
 *
 * 断言（全部通过才 exit 0）：
 *   - integrity_check = ok
 *   - foreign_key_check 无行
 *   - _prisma_migrations 已完成且未回滚的记录数 = 迁移目录数
 *   - 演练前就存在的业务表记录数不变（_prisma_migrations 除外）
 *   - 本次迁移新增的 story_* 6 张表存在
 *
 * 演练库默认在结束后删除；KEEP_TEST_DB=1 保留现场排查。
 */
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const STORY_TABLES = ['story_templates', 'story_template_versions', 'story_runs', 'story_turns', 'story_events', 'story_checkpoints'];

try {
  console.log(JSON.stringify(await runRehearsal(process.argv[2])));
} catch (error) {
  console.error(`迁移演练未通过：${error.message}`);
  process.exitCode = 1;
}

async function runRehearsal(sourceArgument) {
  const root = process.cwd();
  const migrationsDir = path.join(root, 'prisma', 'migrations');
  const available = readdirSync(migrationsDir, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (!available.length) throw Error('prisma/migrations 没有迁移目录。');

  const stamp = `${process.pid}-${Date.now()}`;
  const rehearsal = path.resolve(root, 'prisma', '.local', `rehearsal-${stamp}.db`);
  const staging = path.resolve(root, 'artifacts', `rehearsal-${stamp}`);
  let result;
  try {
    mkdirSync(path.dirname(rehearsal), {recursive: true});
    let source = null;
    if (sourceArgument) {
      source = path.resolve(sourceArgument);
      if (!path.isAbsolute(sourceArgument) || !existsSync(source)) throw Error('源库必须是已存在的绝对路径文件。');
      for (const suffix of ['-wal', '-shm', '-journal']) {
        if (existsSync(source + suffix)) throw Error('源库存在伴随文件，不是单文件快照。请使用 state:backup 产物中的 database.db。');
      }
      copyFileSync(source, rehearsal);
    } else {
      // 本地自证：基线 = 除最新一条外的全部迁移；演练目标 = 最新一条。
      const baselineDir = path.join(staging, 'migrations');
      mkdirSync(baselineDir, {recursive: true});
      for (const name of available.slice(0, -1)) cpSync(path.join(migrationsDir, name), path.join(baselineDir, name), {recursive: true});
      const {createIsolatedDatabase} = await import('./helpers/create-isolated-db.mjs');
      createIsolatedDatabase(rehearsal, {migrationsDir: baselineDir, persist: true});
    }

    const before = snapshotCounts(rehearsal);
    const appliedNow = applyPendingMigrations(rehearsal, migrationsDir);
    const after = snapshotCounts(rehearsal);
    result = assertUpgrade({rehearsal, source, before, after, appliedNow, available});
  } finally {
    if (process.env.KEEP_TEST_DB === '1') {
      console.error(`KEEP_TEST_DB=1，保留演练现场：${rehearsal}`);
    } else {
      // 清理是尽力而为：删除失败（如文件被占用）不应把已通过的演练判为失败，
      // 只提示现场位置，由操作者决定是否人工删除。
      try {
        for (const file of [rehearsal, `${rehearsal}-wal`, `${rehearsal}-shm`, `${rehearsal}-journal`]) rmSync(file, {force: true});
        rmSync(staging, {recursive: true, force: true});
      } catch (cleanupError) {
        console.error(`演练现场清理未完成（不影响演练结论，可人工删除）：${cleanupError.message}\n现场：${rehearsal}`);
      }
    }
  }
  return result;
}

function snapshotCounts(databasePath) {
  const db = new DatabaseSync(databasePath, {readOnly: true});
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all().map(row => row.name);
    return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT COUNT(*) AS c FROM "${table.replaceAll('"', '""')}"`).get().c]));
  } finally {
    db.close();
  }
}

function applyPendingMigrations(databasePath, migrationsDir) {
  const db = new DatabaseSync(databasePath);
  try {
    const applied = new Set(db.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').all().map(row => row.migration_name));
    const record = db.prepare('INSERT INTO _prisma_migrations (id, checksum, started_at, finished_at, migration_name, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)');
    const appliedNow = [];
    for (const name of readdirSync(migrationsDir).filter(entry => statSync(path.join(migrationsDir, entry)).isDirectory()).sort()) {
      if (applied.has(name)) continue;
      const sqlPath = path.join(migrationsDir, name, 'migration.sql');
      if (!existsSync(sqlPath)) throw Error(`迁移缺少 migration.sql：${name}`);
      const sql = readFileSync(sqlPath, 'utf8');
      db.exec('BEGIN');
      try {
        db.exec(sql);
        const now = Date.now();
        record.run(randomUUID(), createHash('sha256').update(sql).digest('hex'), now, now, name);
        db.exec('COMMIT');
        appliedNow.push(name);
      } catch (error) {
        db.exec('ROLLBACK');
        throw Error(`演练迁移失败：${name}\n${error.message}`);
      }
    }
    return appliedNow;
  } finally {
    db.close();
  }
}

function assertUpgrade({rehearsal, source, before, after, appliedNow, available}) {
  const db = new DatabaseSync(rehearsal, {readOnly: true});
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw Error(`integrity_check 结果异常：${integrity}`);
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyViolations.length) throw Error(`foreign_key_check 有 ${foreignKeyViolations.length} 行不一致。`);
    const appliedCount = db.prepare('SELECT COUNT(DISTINCT migration_name) AS c FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').get().c;
    if (appliedCount !== available.length) throw Error(`迁移记录数 ${appliedCount} 与迁移目录数 ${available.length} 不一致。`);
    const unfinished = db.prepare('SELECT COUNT(*) AS c FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL').get().c;
    if (unfinished) throw Error(`存在 ${unfinished} 条未完成迁移记录。`);
    const changed = Object.keys(before).filter(table => before[table] !== after[table]);
    if (changed.length) throw Error(`既有表记录数发生变化：${changed.map(table => `${table} ${before[table]}→${after[table]}`).join(', ')}`);
    const missingTables = STORY_TABLES.filter(table => !Object.hasOwn(after, table));
    if (missingTables.length) throw Error(`新增 story 表缺失：${missingTables.join(', ')}`);
    return {
      mode: source ? 'production-copy' : 'local-baseline',
      source,
      rehearsal,
      appliedNow,
      migrations: {appliedCount, availableCount: available.length, pendingCount: 0},
      integrity: 'ok',
      foreignKeys: 'ok',
      countsPreserved: true,
      newTables: STORY_TABLES,
    };
  } finally {
    db.close();
  }
}
