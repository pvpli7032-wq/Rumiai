/**
 * 隔离数据库构造器。
 *
 * 为什么不用 `prisma migrate deploy`：Prisma 的 schema engine 二进制在部分受限环境里
 * 会直接失败（`Error opening datamodel file ... OS Error 5`），导致所有依赖隔离库的验收
 * 脚本集体跑不起来。迁移文件本身就是普通 SQLite SQL，所以用 node:sqlite 按顺序执行，
 * 并写入 Prisma 期望的 `_prisma_migrations` 记录，让生成客户端与启动门禁都能正常工作。
 *
 * 用法：
 *   import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';
 *   await createIsolatedDatabase(path.resolve('prisma', file));
 *
 * 一次性库会在进程正常退出时自动回收（见下方 registerEphemeralCleanup）；
 * `npm run db:local` 这种「建了就要留着」的场景传 {persist: true}。
 */
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

/** 验收脚本的一次性库命名模板：`<用途>-<pid>-<毫秒时间戳>.db`。 */
const EPHEMERAL_PATTERN = /-\d+-\d{13}\.db$/;

/**
 * 把数据库文件挂到进程退出钩子上自动删除。
 *
 * 为什么加这一层：原先每个脚本各自在 finally 里 rm，只要进程换了退出路径
 * （顶层 await 抛错、断言失败后走到别的 catch、被 Ctrl-C / 超时杀掉）就漏删，
 * 结果是 prisma/ 下堆出几十个再也没人看的库文件。与其事后扫仓库，不如在唯一
 * 的建库入口统一回收。三条约束：
 * - 只有 `-<pid>-<毫秒时间戳>.db` 这种一次性命名会被回收，prisma/.local/dev.db
 *   等长期库不匹配，永远安全；
 * - 只有进程以 0 退出才删，断言失败时保留现场方便排查；
 * - KEEP_TEST_DB=1 强制保留（排查线上问题或想手动翻库时用）。
 */
function registerEphemeralCleanup(databasePath) {
  if (process.env.KEEP_TEST_DB === '1') return;
  if (!EPHEMERAL_PATTERN.test(path.basename(databasePath))) return;
  // Windows 上退出钩子里文件可能仍被占用（EBUSY），清理失败绝不能改变进程退出码：
  // 那是环境残留，不是测试结果。重试几次后放弃，下次创建同名库时仍会先删一遍。
  const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const remove = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try { rmSync(databasePath + suffix, {force: true}); break; }
        catch { if (attempt === 4) return; sleep(50); }
      }
    }
  };
  // exit 钩子里只能用同步 API，且此时 exitCode 已经确定。
  process.once('exit', code => { if (code === 0) { try { remove(); } catch { /* 清理是尽力而为 */ } } });
  // 默认信号行为会直接终止进程、跳过 exit 钩子里除 SIGINT 分支外的逻辑，这里显式接管。
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { try { remove(); } catch { /* 清理是尽力而为 */ } process.exit(1); });
  }
}

export function createIsolatedDatabase(target, options = {}) {
  const databasePath = path.resolve(target);
  const migrationsDir = path.resolve(options.migrationsDir ?? path.resolve('prisma', 'migrations'));
  if (!existsSync(migrationsDir)) throw new Error(`找不到迁移目录：${migrationsDir}`);
  if (!options.persist) registerEphemeralCleanup(databasePath);
  mkdirSync(path.dirname(databasePath), {recursive: true});
  for (const suffix of ['', '-wal', '-shm']) rmSync(databasePath + suffix, {force: true});

  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      finished_at DATETIME,
      migration_name TEXT NOT NULL,
      logs TEXT,
      rolled_back_at DATETIME,
      started_at DATETIME NOT NULL DEFAULT current_timestamp,
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Prisma 把时间写成 epoch 毫秒整数（不是 ISO 字符串），启动门禁按数字比较。
  const record = db.prepare(
    'INSERT INTO _prisma_migrations (id, checksum, started_at, finished_at, migration_name, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)',
  );

  let applied = 0;
  for (const name of readdirSync(migrationsDir).filter(entry => statSync(path.join(migrationsDir, entry)).isDirectory()).sort()) {
    const sqlPath = path.join(migrationsDir, name, 'migration.sql');
    if (!existsSync(sqlPath)) continue;
    const sql = readFileSync(sqlPath, 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      const now = Date.now();
      record.run(randomUUID(), createHash('sha256').update(sql).digest('hex'), now, now, name);
      db.exec('COMMIT');
      applied += 1;
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw new Error(`迁移失败：${name}\n${error.message}`);
    }
  }
  db.close();
  return {database: databasePath, migrations: applied};
}
