/**
 * Consistent SQLite backup.
 *
 * Copying dev.db with cp is not a backup once WAL is enabled: transactions that are
 * committed but not yet checkpointed live in dev.db-wal, so the copy silently misses
 * recent writes. VACUUM INTO asks SQLite itself to write one complete, consistent file.
 *
 *   node ops/scripts/backup-db.mjs [label]
 */
import {loadWorkspaceEnvironment} from '../runtime/environment.mjs';
import path from 'node:path';
import { backupSqliteDatabase, resolveSqliteSource } from '../../packages/backend/src/modules/operations/sqlite-backup.mjs';
import {backupDirectory} from '../../packages/backend/src/modules/operations/backup-directory.mjs';

loadWorkspaceEnvironment();
try {
  const label = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-');
  if (process.argv.length > 3 || !/^[A-Za-z0-9_-]{1,80}$/.test(label)) throw Error('备份标签仅支持 1–80 位字母、数字、下划线和连字符。');
  const source = resolveSqliteSource(process.env.DATABASE_URL);
  const target = path.join(backupDirectory(), `${path.basename(source, path.extname(source))}-${label}.db`);
  const report = await backupSqliteDatabase(source, target);
  console.log(`备份完成：${report.target}`);
  console.log(JSON.stringify({ integrity: report.integrity, foreignKeys: report.foreignKeys, counts: report.counts }));
} catch (error) {
  console.error(`备份失败：${error.message}`);
  process.exitCode = 1;
}
