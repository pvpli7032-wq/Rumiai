/** Mirrors the public visibility and review queue rules used by the character API. */
export function characterPublicationLabel(role: {isPublic: boolean; publicationRequested: boolean; reviewStatus: string}): string {
  if (role.reviewStatus === 'DELETED') return '已移除';
  if (role.isPublic && role.reviewStatus === 'APPROVED') return '已发布';
  if (role.publicationRequested && role.reviewStatus === 'PENDING') return '待审核';
  if (role.reviewStatus === 'REJECTED') return '审核退回';
  return '私有作品';
}
