import { db } from '@/lib/db';

export class ModerationReadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'ModerationReadError';
  }
}

const reportStatuses = ['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED', 'ALL'] as const;
const appealStatuses = ['OPEN', 'ACCEPTED', 'REJECTED', 'ALL'] as const;

export async function listModerationReports(status: string, take: number) {
  if (!reportStatuses.includes(status as typeof reportStatuses[number])) throw new ModerationReadError('举报状态不正确。');
  const reports = await db.report.findMany({
    where: status === 'ALL' ? {} : {status},
    orderBy: [{createdAt: 'asc'}, {id: 'asc'}], take,
    select: {
      id: true, targetType: true, targetId: true, category: true, details: true, evidenceContent: true,
      imageReason: true, workTitle: true, relationship: true, sourceLink: true, status: true, createdAt: true,
      reporter: {select: {id: true, username: true, displayName: true}},
    },
  });
  return Promise.all(reports.map(async report => {
    let target: unknown = null;
    if (report.targetType === 'POST') target = await db.post.findUnique({where: {id: report.targetId}, select: {id: true, content: true, status: true, author: {select: {id: true, username: true}}, circle: {select: {id: true, name: true, status: true}}}});
    else if (report.targetType === 'POST_COMMENT') target = await db.postComment.findUnique({where: {id: report.targetId}, select: {id: true, content: true, imageUrl: true, status: true, author: {select: {id: true, username: true}}, post: {select: {id: true, content: true, circle: {select: {id: true, name: true}}}}}});
    else if (report.targetType === 'USER') target = await db.user.findUnique({where: {id: report.targetId}, select: {id: true, username: true, displayName: true, communityBannedAt: true, communityBanReason: true}});
    else if (report.targetType === 'CHARACTER') target = await db.character.findUnique({where: {id: report.targetId}, select: {id: true, name: true, isPublic: true, reviewStatus: true, creator: {select: {id: true, username: true}}}});
    return {...report, target};
  }));
}

export async function listCommunityAppeals(status: string) {
  if (!appealStatuses.includes(status as typeof appealStatuses[number])) throw new ModerationReadError('申诉状态不正确。');
  return db.communityAppeal.findMany({
    where: status === 'ALL' ? {} : {status},
    orderBy: [{createdAt: 'asc'}, {id: 'asc'}], take: 50,
    select: {id: true, userId: true, reason: true, status: true, resolution: true, createdAt: true, user: {select: {username: true, communityBannedAt: true, communityBanReason: true}}},
  });
}

export async function listModerationAudit() {
  return db.moderationAction.findMany({
    orderBy: {createdAt: 'desc'}, take: 100,
    select: {id: true, targetType: true, targetId: true, action: true, reason: true, createdAt: true, actor: {select: {id: true, username: true}}},
  });
}
