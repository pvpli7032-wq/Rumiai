import { getAuthUser } from '@/lib/auth';
export function isModerator(userId:string){
 return (process.env.MODERATOR_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(userId);
}
export async function getModerator(request:Request){
 const user=await getAuthUser(request);
 return user && isModerator(user.userId) ? user : null;
}
