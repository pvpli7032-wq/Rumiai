import { restoreStateBackup } from '../../packages/backend/src/modules/operations/state-backup.mjs';

try {
  if (process.argv.length !== 4) throw Error('用法：node ops/scripts/restore-state.mjs <备份目录> <全新恢复目录>');
  const report = await restoreStateBackup(process.argv[2], process.argv[3]);
  console.log(`数据库与上传已恢复到新目录：${report.source}`);
  console.log(JSON.stringify({ integrity: report.integrity, foreignKeys: report.foreignKeys, counts: report.counts, uploadedFiles: report.manifest.uploads.length }));
  console.log('未切换运行服务；配置 DATABASE_URL 与 UPLOADS_DIRECTORY 后在隔离实例核验，再决定开放访问。');
} catch (error) {
  console.error(`恢复未完成：${error.message} 如已创建目录，请保留排查并使用新目标重试。`);
  process.exitCode = 1;
}
