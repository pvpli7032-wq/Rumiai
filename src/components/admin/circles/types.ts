export type ManagedCircle = {
  id: string; name: string; description: string; tags: string | null; ownerId: string | null; universeId: string | null;
  status: string; isFeatured: boolean; createdAt: string; updatedAt: string;
  owner: {id: string; username: string; displayName: string | null; deletedAt: string | null} | null;
  _count: {members: number; posts: number; restrictions: number};
};
export type CircleList = {items: ManagedCircle[]; total: number; page: number; pageSize: number};
export type CircleContent = {name: string; description: string; tags: string; universeId: string | null};
export type CircleAction = 'SAVE' | 'HIDE' | 'RESTORE' | 'FEATURE' | 'UNFEATURE';
export type ManagedCircleMember = {userId: string; status: string; createdAt: string; updatedAt: string; reason: string | null; user: {id: string; username: string; displayName: string | null; deletedAt: string | null; suspendedAt: string | null}};
export type MemberList = {items: ManagedCircleMember[]; total: number; page: number; pageSize: number};
export type MemberAction = 'REMOVE' | 'BLOCK' | 'UNBLOCK';
export const memberActionLabels = {REMOVE: '移除成员', BLOCK: '限制加入', UNBLOCK: '解除限制'};
