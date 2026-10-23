// Operator maintenance: only files listed by an already-confirmed account closure.
import {loadWorkspaceEnvironment} from '../runtime/environment.mjs';
loadWorkspaceEnvironment();
const { db, pragmasReady } = await import('../../packages/backend/src/infrastructure/database/client.ts');
try {
  await pragmasReady;
  const { retryPendingClosureFiles } = await import('../../packages/backend/src/modules/uploads/privacy.ts');
  console.log(JSON.stringify(await retryPendingClosureFiles()));
} catch {
  console.error('文件清理未完成，请核对数据库迁移、上传目录权限和待核查的共享文件。');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
