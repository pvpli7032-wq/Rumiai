import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { constants } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';

const sidecars = ['-wal', '-shm', '-journal'];
const fileUrl = file => `file:${path.resolve(file).split(path.sep).join('/')}`;
const literal = value => `'${value.replaceAll("'", "''")}'`;

async function requireDatabase(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) throw Error('数据库文件不存在、为空或不是文件。');
}

async function requireUnusedTarget(file) {
  for (const suffix of ['', ...sidecars]) {
    try { await stat(file + suffix); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw Error('目标数据库或附属文件已存在，拒绝覆盖。');
  }
}

export function resolveSqliteSource(url, root = process.cwd()) {
  if (!url?.startsWith('file:') || !url.slice(5).split('?')[0]) throw Error('DATABASE_URL 必须指定 SQLite 文件。');
  return path.resolve(root, 'prisma', url.slice(5).split('?')[0]);
}

/** Inspect the snapshot itself; no user content, tokens or credentials in output. */
export async function inspectSqliteSnapshot(file) {
  file = path.resolve(file);
  await requireDatabase(file);
  const db = new PrismaClient({ datasources: { db: { url: fileUrl(file) } } });
  try {
    await db.$executeRawUnsafe('PRAGMA query_only = ON');
    const integrity = await db.$queryRawUnsafe('PRAGMA integrity_check');
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw Error('数据库完整性检查失败。');
    const foreignKeys = await db.$queryRawUnsafe('PRAGMA foreign_key_check');
    if (foreignKeys.length) throw Error('数据库存在外键不一致。');
    const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    if (!tables.some(table => table.name === '_prisma_migrations')) throw Error('数据库缺少 Prisma 迁移历史。');
    const unfinished = await db.$queryRawUnsafe('SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL');
    if (Number(unfinished[0].count)) throw Error('数据库存在未完成迁移。');
    const counts = {};
    for (const table of tables) {
      const identifier = `"${table.name.replaceAll('"', '""')}"`;
      const result = await db.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM ${identifier}`);
      counts[table.name] = Number(result[0].count);
    }
    return { integrity: 'ok', foreignKeys: 'ok', counts };
  } finally { await db.$disconnect(); }
}

export async function backupSqliteDatabase(source, target) {
  source = path.resolve(source); target = path.resolve(target);
  await requireDatabase(source);
  await requireUnusedTarget(target);
  await mkdir(path.dirname(target), { recursive: true });
  const db = new PrismaClient({ datasources: { db: { url: fileUrl(source) } } });
  try {
    await db.$queryRawUnsafe('PRAGMA busy_timeout = 8000');
    await db.$executeRawUnsafe(`VACUUM INTO ${literal(target.split(path.sep).join('/'))}`);
  } finally { await db.$disconnect(); }
  return { target, ...await inspectSqliteSnapshot(target) };
}

/** Restore to a NEW file only. Switching a live service is an operator step. */
export async function restoreSqliteDatabase(backup, target) {
  backup = path.resolve(backup); target = path.resolve(target);
  await requireUnusedTarget(target);
  for (const suffix of sidecars) {
    try { await stat(backup + suffix); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw Error('恢复源必须是完整的单文件备份，不能含 WAL 或 journal 附属文件。');
  }
  const snapshot = await inspectSqliteSnapshot(backup);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(backup, target, constants.COPYFILE_EXCL);
  const restored = await inspectSqliteSnapshot(target);
  if (JSON.stringify(restored.counts) !== JSON.stringify(snapshot.counts)) throw Error('恢复数据库的记录计数与备份不一致。');
  return { target, ...restored };
}
