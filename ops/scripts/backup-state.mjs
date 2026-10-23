import {loadWorkspaceEnvironment} from '../runtime/environment.mjs';
import path from 'node:path';
import {backupDirectory} from '../../packages/backend/src/modules/operations/backup-directory.mjs';
import { resolveSqliteSource } from '../../packages/backend/src/modules/operations/sqlite-backup.mjs';
import { createStateBackup } from '../../packages/backend/src/modules/operations/state-backup.mjs';
import { uploadDirectory } from '../../packages/backend/src/modules/uploads/storage-location.mjs';

loadWorkspaceEnvironment();
try {
  const label = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-');
  if (process.argv.length > 3 || !/^[A-Za-z0-9_-]{1,80}$/.test(label)) throw Error('备份标签仅支持 1–80 位字母、数字、下划线和连字符。');
  const source = resolveSqliteSource(process.env.DATABASE_URL);
  const target = path.join(backupDirectory(), `${path.basename(source, path.extname(source))}-${label}`);
  const report = await createStateBackup(source, uploadDirectory(), target);
  console.log(`数据库与上传备份完成：${report.source}`);
  console.log(JSON.stringify({ integrity: report.integrity, foreignKeys: report.foreignKeys, counts: report.counts, uploadedFiles: report.manifest.uploads.length, uploadReferences: report.manifest.referenceCount }));
} catch (error) {
  console.error(`完整备份未完成：${error.message} 如已创建目录，请保留排查并使用新标签重试。`);
  process.exitCode = 1;
}
