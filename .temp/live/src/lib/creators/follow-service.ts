import {db,pragmasReady} from '@/lib/db';

export class CreatorFollowError extends Error{
  constructor(message:string,status:number){super(message);this.name='CreatorFollowError';this.status=status;}
  status:number;
}

export async function resolveCreatorFollowTarget(actorId:string,username:string,rejectSelf=false){
  const target=await db.user.findUnique({where:{username},select:{id:true}});
  if(!target)throw new CreatorFollowError('创作者不存在。',404);
  if(rejectSelf&&target.id===actorId)throw new CreatorFollowError('不能关注自己。',400);
  return target;
}

function isUniqueViolation(error:unknown){return typeof error==='object'&&error!==null&&'code'in error&&error.code==='P2002';}

export async function followCreator(actorId:string,targetId:string){
  await pragmasReady;
  try{
    return await db.$transaction(async tx=>{
      const existing=await tx.follow.findUnique({where:{followerId_followingId:{followerId:actorId,followingId:targetId}},select:{followerId:true}});
      let changed=false;
      if(!existing){await tx.follow.create({data:{followerId:actorId,followingId:targetId}});changed=true;}
      const followerCount=await tx.follow.count({where:{followingId:targetId}});
      await tx.user.update({where:{id:targetId},data:{followerCount}});
      return {following:true,changed,followerCount};
    });
  }catch(error){
    if(!isUniqueViolation(error))throw error;
    const [existing,followerCount]=await Promise.all([
      db.follow.findUnique({where:{followerId_followingId:{followerId:actorId,followingId:targetId}},select:{followerId:true}}),
      db.follow.count({where:{followingId:targetId}}),
    ]);
    if(!existing)throw error;
    return {following:true,changed:false,followerCount};
  }
}

export async function unfollowCreator(actorId:string,targetId:string){
  await pragmasReady;
  return db.$transaction(async tx=>{
    const removed=await tx.follow.deleteMany({where:{followerId:actorId,followingId:targetId}});
    const followerCount=await tx.follow.count({where:{followingId:targetId}});
    await tx.user.update({where:{id:targetId},data:{followerCount}});
    return {following:false,changed:removed.count>0,followerCount};
  });
}
