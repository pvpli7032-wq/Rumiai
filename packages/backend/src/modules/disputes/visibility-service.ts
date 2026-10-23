import type {Prisma} from '@prisma/client';

/**
 * 停止公开访问的共用写入（V3 §24「公开与撤回」：可由作者撤回或后台隐藏）。
 *
 * 撤回与隐藏要做的是同一件事：案例置 WITHDRAWN、帖子置 HIDDEN。
 * 读侧本来就按这两点判断——非发起人访问 404、公开列表不出现、投票被拒、结案任务 SKIPPED——
 * 所以这里只写这两个字段，不再造第二套可见性判断。
 */
export async function markCaseHidden(tx: Prisma.TransactionClient, input: {caseId: string; postId: string}) {
  await tx.disputeCase.update({where: {id: input.caseId}, data: {closeStatus: 'WITHDRAWN'}});
  await tx.post.update({where: {id: input.postId}, data: {status: 'HIDDEN'}});
}
