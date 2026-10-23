import {loadWorkspaceEnvironment} from '../runtime/environment.mjs';
loadWorkspaceEnvironment();
const bcrypt = (await import('bcryptjs')).default;
const {db} = await import('../../packages/backend/src/infrastructure/database/client.ts');
const {readRegistrationRules} = await import('@rumiai/backend/modules/settings/index');

/**
 * 设置指定账号的登录密码（V3 表 0、§27：超级管理员密码由负责人指定）。
 *
 * 这是服务器上的一次性运维动作，不是「每次启动自动重置」—— 不在应用启动路径里调用，
 * 也没有任何接口能触发它。哈希成本与注册一致（bcrypt 10），改完 bump tokenVersion，
 * 旧会话立即失效。
 *
 * 用法：npm run account:password -- <邮箱> <新密码>
 */
const MAX_PASSWORD_BYTES = 72;

try {
  const [email, password] = process.argv.slice(2);
  if (!email?.trim() || !password) throw new Error('用法：npm run account:password -- <邮箱> <新密码>');
  const rules = await readRegistrationRules();
  if (password.length < rules.passwordMinLength) throw new Error(`密码至少 ${rules.passwordMinLength} 位。`);
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw new Error('密码过长。');
  const user = await db.user.findUnique({where: {email: email.trim().toLowerCase()}, select: {id: true, deletedAt: true}});
  if (!user || user.deletedAt) throw new Error('未找到该邮箱对应的有效账号。');
  const passwordHash = await bcrypt.hash(password, 10);
  await db.$transaction(async tx => {
    await tx.user.update({where: {id: user.id}, data: {passwordHash, tokenVersion: {increment: 1}}});
    await tx.adminSession.deleteMany({where: {userId: user.id}});
  });
  console.log(JSON.stringify({passwordUpdated: true, userId: user.id}));
} catch (error) {
  console.error(error instanceof Error ? error.message : '密码设置失败');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
