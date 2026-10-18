// node scripts/restore-db.mjs <backup-file> <new-database-file>
import { restoreSqliteDatabase } from '../src/lib/operations/sqlite-backup.mjs';

try {
  if (process.argv.length !== 4) throw Error('用法：node scripts/restore-db.mjs <备份文件> <全新数据库文件>');
  const report = await restoreSqliteDatabase(process.argv[2], process.argv[3]);
  console.log(`恢复完成：${report.target}`);
  console.log(JSON.stringify({ integrity: report.integrity, foreignKeys: report.foreignKeys, counts: report.counts }));
  console.log('尚未切换运行服务；停服后配置 DATABASE_URL 指向恢复库，并核验后再开放访问。');
} catch (error) {
  console.error(`恢复失败：${error.message}`);
  process.exitCode = 1;
}
