import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const {bootstrapOwner} = await import('../src/lib/admin/management-service.ts');
const {db} = await import('../src/lib/db.ts');
try {
  if (process.argv.length !== 3 || !process.argv[2].trim()) throw Error('用法：npm run admin:bootstrap -- <已注册邮箱>');
  const result = await bootstrapOwner(process.argv[2]);
  console.log(JSON.stringify({ownerInitialized: true, userId: result.userId, created: result.created}));
} catch (error) {console.error(error instanceof Error ? error.message : '管理员初始化失败'); process.exitCode = 1;}
finally {await db.$disconnect();}
