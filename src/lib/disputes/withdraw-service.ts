import {db, pragmasReady} from '@/lib/db';
import {DisputeError} from './case-service';

/**
 * 撤回（V3 §24）。
 *
 * 发起人撤回后停止公开访问：案例置 WITHDRAWN，帖子置 HIDDEN，读侧对非发起人返回 404。
 * 只有 OPEN 能撤回——已经进入结案（CLOSING）或已出结果（CLOSED）的案例不再接受撤回，
 * 否则会出现「回应已生成但案例消失」的矛盾。
 * 评论、点赞与举报记录保留：已公开的截图无法远程收回，所以撤回不是删除。
 */
export async function withdrawDisputeCase(userId: string, caseId: string) {
  await pragmasReady;
  return db.$transaction(async tx => {
    const row = await tx.disputeCase.findUnique({where: {id: caseId}, select: {authorId: true, closeStatus: true, postId: true}});
    if (!row) throw new DisputeError('评理案例不存在。', 404, 'NOT_FOUND');
    if (row.authorId !== userId) throw new DisputeError('只能撤回自己发起的案例。', 403, 'FORBIDDEN');
    // 重复撤回是幂等的：网络重试不该报错。
    if (row.closeStatus === 'WITHDRAWN') return {withdrawn: true};
    if (row.closeStatus === 'CLOSED') throw new DisputeError('案例已经结案，结案结果不能撤回。', 409, 'CONFLICT');
    if (row.closeStatus === 'CLOSING') throw new DisputeError('案例正在结案，角色回应生成中，无法撤回。', 409, 'CONFLICT');
    await tx.disputeCase.update({where: {id: caseId}, data: {closeStatus: 'WITHDRAWN'}});
    await tx.post.update({where: {id: row.postId}, data: {status: 'HIDDEN'}});
    return {withdrawn: true};
  });
}
