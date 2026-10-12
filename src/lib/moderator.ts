import { getAuthUser } from '@/lib/auth';
export async function getModerator(request:Request){
 const user=await getAuthUser(request);
 const ids=(process.env.MODERATOR_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 return user && ids.includes(user.userId) ? user : null;
}
