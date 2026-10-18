/**
 * 本机建库：Prisma 的 schema engine 在当前工具沙箱里无法写文件，但迁移文件本身
 * 就是普通 SQLite SQL，所以直接用 node:sqlite 按顺序执行，并写入 Prisma 期望的
 * `_prisma_migrations` 记录（含子串校验和），让 `next build` 与启动门禁都能在
 * 本机跑通。
 *
 * 用法：node scripts/make-local-db.mjs [输出路径]
 * 默认输出 prisma/.local/dev.db，重复运行会重建。
 */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const target = path.resolve(process.argv[2] ?? 'prisma/.local/dev.db');
const migrationsDir = path.resolve('prisma/migrations');

if (!existsSync(migrationsDir)) {
  console.error(`找不到迁移目录：${migrationsDir}`);
  process.exit(1);
}
mkdirSync(path.dirname(target), {recursive: true});
for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, {force: true});

const dirs = readdirSync(migrationsDir)
  .filter(name => statSync(path.join(migrationsDir, name)).isDirectory())
  .sort();

const db = new DatabaseSync(target);
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
for (const name of dirs) {
  const sqlPath = path.join(migrationsDir, name, 'migration.sql');
  if (!existsSync(sqlPath)) continue;
  const sql = readFileSync(sqlPath, 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    const now = Date.now();
    record.run(crypto.randomUUID(), createHash('sha256').update(sql).digest('hex'), now, now, name);
    db.exec('COMMIT');
    applied += 1;
  } catch (error) {
    db.exec('ROLLBACK');
    console.error(`迁移失败：${name}\n${error.message}`);
    process.exit(1);
  }
}

const tables = db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'").get().c;
const recorded = db.prepare('SELECT count(*) AS c FROM _prisma_migrations').get().c;
db.close();
console.log(JSON.stringify({database: target, migrations: applied, recorded, tables}));
