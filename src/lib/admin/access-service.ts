import {isModerator} from '@/lib/moderator';
import {isFinanceAdmin} from '@/lib/payments/finance-auth';

/** Each domain remains the authority for its own permissions. */
export function readAdminAccess(userId: string) {
  return {moderation: isModerator(userId), finance: isFinanceAdmin(userId)};
}
