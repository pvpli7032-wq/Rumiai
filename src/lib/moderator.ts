import { getAuthUser } from '@/lib/auth';
import {hasAdminPermission} from '@/lib/admin/authorization';
export function isModerator(userId:string){
 return hasAdminPermission(userId, 'moderation.read');
}
export async function getModerator(request:Request, permission: 'moderation.read' | 'moderation.write' = 'moderation.write'){
 const user=await getAuthUser(request);
 return user && await hasAdminPermission(user.userId, permission) ? user : null;
}
