import {PrismaClient} from '@prisma/client';import bcrypt from 'bcryptjs';
const db=new PrismaClient();
async function main(){
const owner=await db.user.upsert({where:{email:'original-seed@example.invalid'},update:{},create:{username:'星伴原创角色',displayName:'星伴原创角色',email:'original-seed@example.invalid',passwordHash:await bcrypt.hash(crypto.randomUUID(),10),avatarUrl:'/brand/icon.svg'}});
const personas=[["林澈","Male","温和的图书馆管理员","书架之间，总有一个故事等着被发现。"],["星野","Female","好奇的天文观测员","今晚的星空，你想先看哪一颗？"],["晴川","Male","热爱旅行的摄影师","沿着河岸走走，或许会发现新的风景。"],["知夏","Female","细心的植物研究者","新长出来的叶子，也值得认真庆祝。"],["墨白","Male","专注的独立音乐人","你今天的心情，会是什么旋律？"],["映雪","Female","喜欢推理的书店店主","来挑一本书吧，我们可以一起寻找故事里的线索。"]];
for(const [i,[name,gender,personality,greeting]] of personas.entries()){const data={name,tagline:personality,personality:personality+'。说话自然简洁，善于倾听，尊重对方的选择，不替用户决定行动。',background:'这是一位由星伴内部测试版创作的虚构角色。生活在名为星河街的普通小镇，与访客分享自己的兴趣和日常。所有角色设定均为原创测试内容。',greeting,avatarUrl:'/brand/persona-'+i+'.svg',creatorId:owner.id,isPublic:true,publicationRequested:true,reviewStatus:'APPROVED',copyrightStatement:'星伴原创虚构角色；头像为项目原创 SVG，仅供内部测试。',tags:gender+',Original',scenario:'小镇的午后，你来到角色熟悉的工作空间，开始第一次交流。',relationshipStatus:'初识'};await db.character.upsert({where:{id:'xingban-original-'+i},update:{},create:{id:'xingban-original-'+i,...data}})}
for(const [i,title]of ['体验角色社区','探索原创故事'].entries())await db.mission.upsert({where:{id:'xingban-onboarding-'+i},update:{},create:{id:'xingban-onboarding-'+i,title,description:'内部测试体验奖励，领取一次；不代表行为已被自动检测。',rewardCoins:10,category:'ONBOARDING'}});
console.log('原创角色 6 位；种子可重复执行，不删除用户、账本或对话。');}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
