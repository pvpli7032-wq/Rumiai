import {readAdminAuthorization} from './authorization';

/** Each domain remains the authority for its own permissions. */
export async function readAdminAccess(userId: string) {
  const {permissions} = await readAdminAuthorization(userId);
  return {moderation: permissions.includes('moderation.read'), finance: permissions.includes('finance.read')};
}
