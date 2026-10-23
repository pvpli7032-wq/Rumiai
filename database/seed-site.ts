import {PrismaClient} from '@prisma/client';const db=new PrismaClient();
import { initializeDefaultPackages } from '../packages/backend/src/modules/coins/default-packages';
async function main(){
const banners=[['每日签到','领取测试金币，记录你的每日陪伴','/profile'],['创作属于你的角色','设置性格与故事，发布原创作品','/creator'],['发现新的故事','与原创角色聊聊日常与想象','/discover']];
for(const placement of ['HERO','SIDEBAR'])for(const [i,[title,description,href]]of banners.entries()){const id='xingban-banner-'+placement+'-'+i;await db.banner.upsert({where:{id},update:{},create:{id,placement,title,description,href,gradientFrom:'#ea580c',gradientTo:'#9333ea',sortOrder:i}})}
for(const [i,[key,label,group,filterRow]]of [['Male','男性','类型','type'],['Female','女性','类型','type'],['Original','原创','类型','type'],['Fantasy','幻想','题材','role'],['Daily','日常','题材','role']].entries())await db.tag.upsert({where:{key},update:{label,group,filterRow},create:{key,label,group,filterRow,sortOrder:i}});
for(const [i,[key,title,source]]of [['for-you','为你推荐','FOR_YOU'],['newest','最近发布','NEWEST'],['popular','热门角色','POPULAR']].entries())await db.homeSection.upsert({where:{key},update:{title,source},create:{key,title,source,emoji:'✨',sortOrder:i}});
await initializeDefaultPackages(db);
const signs=['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'],names=['白羊','金牛','双子','巨蟹','狮子','处女','天秤','天蝎','射手','摩羯','水瓶','双鱼'];
for(const [i,sign]of signs.entries()){const data={sign,thaiName:names[i]+'座',title:names[i]+'座 · 娱乐测试',description:'尝试一件小小的新事物，也为自己留一点休息时间。本内容为固定娱乐文案，不是预测。',luckyNumber:i+1,luckyColor:'橙色',compatibility:'友善的伙伴',advice:'关心当下的感受，按自己的节奏前进。'};await db.horoscope.upsert({where:{sign},update:data,create:data})}console.log('中文站点内容与三档人民币充值套餐已初始化；真实支付仍由商户配置和开关控制。');}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
