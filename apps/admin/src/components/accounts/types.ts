import type {AdminAccountAssets} from '@rumiai/contracts/admin/account-assets';

export type ManagedAccount = {id: string; username: string; displayName: string | null; avatarUrl: string | null; email: string; coins: number; tier: string; createdAt: string; lastLoginAt: string | null; lastActiveAt: string | null; suspendedAt: string | null; suspensionReason: string | null; deletedAt: string | null; communityBannedAt: string | null; communityBanReason: string | null; accountVersion: number};
export type AccountList = {items: ManagedAccount[]; total: number; page: number; pageSize: number};
export type AccountDetail = {user: ManagedAccount & {_count: {characters: number; conversations: number; posts: number; paymentOrders: number; reportsFiled: number}}; characters: {id: string; name: string; reviewStatus: string; isPublic: boolean; createdAt: string}[]; orders: {orderNo: string; status: string; coinAmount: number; amountCnyCents: number; createdAt: string}[]; ledger: {id: string; type: string; amount: number; createdAt: string}[] | null; activity: {id: string; action: string; reason: string; actorId: string; createdAt: string}[]; relatedLimit: number; canReadFinance: boolean; assets?: AdminAccountAssets};
export type AccountAction = 'SUSPEND' | 'RESTORE' | 'REVOKE_SESSIONS' | 'BAN_COMMUNITY' | 'UNBAN_COMMUNITY';
export const actionLabels: Record<AccountAction, string> = {SUSPEND: '停用网站账号', RESTORE: '恢复网站账号', REVOKE_SESSIONS: '撤销全部登录会话', BAN_COMMUNITY: '禁止社区发言', UNBAN_COMMUNITY: '恢复社区发言'};
export const auditLabels: Record<string, string> = Object.fromEntries(Object.entries(actionLabels).map(([action, label]) => [`ACCOUNT_${action}`, label]));
export const accountState = (user: ManagedAccount) => user.deletedAt ? '已注销' : user.suspendedAt ? '已停用' : '正常';
export const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '尚无记录';
