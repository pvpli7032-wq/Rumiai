import {hasAdminPermission} from '@/lib/admin/authorization';
import {requireAdmin} from '@/lib/http/auth';

export function isModerator(userId:string){
 return hasAdminPermission(userId, 'moderation.read');
}
/** Thin wrapper over the route layer's permission check; kept for existing callers and tests. */
export async function getModerator(request:Request, permission: 'moderation.read' | 'moderation.write' = 'moderation.write'){
 const access=await requireAdmin(request, permission);
 return access.ok ? access.user : null;
}
