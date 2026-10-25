import {db} from '@rumiai/backend/infrastructure/database/client';
export class DiscoveryPreferenceError extends Error {constructor(message:string,readonly status=400){super(message);}}
export async function readDiscoveryPreferences(userId:string) {
  const [history,hidden]=await Promise.all([
    db.userSearchHistory.findMany({where:{userId},orderBy:{lastUsedAt:'desc'},take:20,select:{query:true,lastUsedAt:true}}),
    db.userHiddenCharacter.findMany({where:{userId},orderBy:{createdAt:'desc'},include:{character:{select:{id:true,name:true,isPublic:true,reviewStatus:true}}}}),
  ]);
  return {history,hidden:hidden.map(row=>({id:row.characterId,name:row.character.isPublic&&row.character.reviewStatus==='APPROVED'?row.character.name:'已下架角色'}))};
}
export async function rememberDiscoverySearch(userId:string,input:unknown) {
  const query=typeof input==='string'?input.trim():'';
  if(!query||query.length>200)throw new DiscoveryPreferenceError('搜索词须为1至200字。');
  return db.$transaction(async tx=>{
    await tx.userSearchHistory.upsert({where:{userId_query:{userId,query}},create:{userId,query},update:{lastUsedAt:new Date()}});
    const older=await tx.userSearchHistory.findMany({where:{userId},orderBy:[{lastUsedAt:'desc'},{id:'desc'}],skip:20,select:{id:true}});
    if(older.length)await tx.userSearchHistory.deleteMany({where:{userId,id:{in:older.map(row=>row.id)}}});
    return {success:true};
  });
}
export async function clearDiscoverySearch(userId:string,query?:string) {
  await db.userSearchHistory.deleteMany({where:{userId,...(query?{query}:{})}});
  return {success:true};
}
export async function setHiddenCharacter(userId:string,characterId:string,hidden:boolean) {
  if(!hidden){await db.userHiddenCharacter.deleteMany({where:{userId,characterId}});return {success:true};}
  const character=await db.character.findFirst({where:{id:characterId,isPublic:true,reviewStatus:'APPROVED'},select:{id:true}});
  if(!character)throw new DiscoveryPreferenceError('角色不存在或未公开。',404);
  await db.userHiddenCharacter.upsert({where:{userId_characterId:{userId,characterId}},create:{userId,characterId},update:{}});
  return {success:true};
}
