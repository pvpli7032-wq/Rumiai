import {db,pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {readAiCostReport} from '@/lib/ai/cost-report';
import {readPaymentValidationMetrics} from '@/lib/payments/validation-metrics';

export class AnalyticsReportError extends Error{
  constructor(message:string,public status=400){super(message);this.name='AnalyticsReportError';}
}

export async function readAnalyticsReport(actorId:string,days:number){
  if(!Number.isInteger(days)||days<1||days>90)throw new AnalyticsReportError('统计天数必须为 1–90 的整数。');
  await pragmasReady;
  return db.$transaction(async tx=>{
    if(!await hasAdminPermission(actorId,'analytics.read',tx))throw new AnalyticsReportError('当前账号没有运营分析权限。',403);
    const generatedAt=new Date(),since=new Date(generatedAt.getTime()-days*86400000),todayUtc=new Date(Date.UTC(generatedAt.getUTCFullYear(),generatedAt.getUTCMonth(),generatedAt.getUTCDate())),cohortSince=new Date(Date.UTC(generatedAt.getUTCFullYear(),generatedAt.getUTCMonth(),generatedAt.getUTCDate()-days-30));
    const paidWhere={currency:'CNY',status:{in:['PAID','REFUND_PENDING','REFUNDED']},paidAt:{gte:since,lte:generatedAt}};
    const [newUsers,activeUsers,newConversations,userMessages,assistantMessages,visiblePosts,visibleComments,moderationActions,paidOrders,payingUsers,paidTotals,refundTotals,aiCosts,paymentMetrics,activityFloor,cohortRows]=await Promise.all([
      tx.user.count({where:{createdAt:{gte:since,lte:generatedAt}}}),
      tx.user.count({where:{lastActiveAt:{gte:since,lte:generatedAt},deletedAt:null,suspendedAt:null}}),
      tx.conversation.count({where:{createdAt:{gte:since,lte:generatedAt}}}),
      tx.message.count({where:{role:'USER',createdAt:{gte:since,lte:generatedAt}}}),
      tx.message.count({where:{role:'ASSISTANT',createdAt:{gte:since,lte:generatedAt}}}),
      tx.post.count({where:{status:'VISIBLE',createdAt:{gte:since,lte:generatedAt}}}),
      tx.postComment.count({where:{status:'VISIBLE',createdAt:{gte:since,lte:generatedAt}}}),
      tx.moderationAction.count({where:{createdAt:{gte:since,lte:generatedAt}}}),
      tx.paymentOrder.count({where:paidWhere}),
      tx.user.count({where:{paymentOrders:{some:paidWhere}}}),
      tx.paymentOrder.aggregate({where:paidWhere,_count:{_all:true},_sum:{amountCnyCents:true}}),
      tx.paymentRefund.aggregate({where:{status:'SUCCEEDED',completedAt:{gte:since,lte:generatedAt},paymentOrder:{currency:'CNY'}},_count:{_all:true},_sum:{amountCnyCents:true}}),
      readAiCostReport(tx,since,generatedAt),
      readPaymentValidationMetrics(tx,since,generatedAt),
      tx.userActivityDay.aggregate({_min:{activityDate:true}}),
      tx.$queryRaw<Array<{cohort_date:string;cohortSize:number;d1:number;d7:number;d30:number}>>`
        SELECT date(u.created_at / 1000.0,'unixepoch') AS cohort_date,
          COUNT(*) AS cohortSize,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM user_activity_days a WHERE a.user_id=u.id AND date(a.activity_date / 1000.0,'unixepoch')=date(u.created_at / 1000.0,'unixepoch','+1 day')) THEN 1 ELSE 0 END) AS d1,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM user_activity_days a WHERE a.user_id=u.id AND date(a.activity_date / 1000.0,'unixepoch')=date(u.created_at / 1000.0,'unixepoch','+7 day')) THEN 1 ELSE 0 END) AS d7,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM user_activity_days a WHERE a.user_id=u.id AND date(a.activity_date / 1000.0,'unixepoch')=date(u.created_at / 1000.0,'unixepoch','+30 day')) THEN 1 ELSE 0 END) AS d30
        FROM users u WHERE u.deleted_at IS NULL AND u.created_at >= ${cohortSince} AND u.created_at <= ${generatedAt}
        GROUP BY date(u.created_at / 1000.0,'unixepoch') ORDER BY cohort_date DESC LIMIT ${days}
      `,
    ]);
    const retentionCohorts=cohortRows.map(row=>{
      const cohortDate=new Date(`${row.cohort_date}T00:00:00.000Z`),cohortSize=Number(row.cohortSize);
      const metric=(offset:number,returned:number)=>{const targetDate=new Date(cohortDate.getTime()+offset*86400000),matured=targetDate<todayUtc;return {returned:Number(returned),matured,rate:matured&&cohortSize>0?Number(returned)/cohortSize:null};};
      return {cohortDate:row.cohort_date,cohortSize,d1:metric(1,row.d1),d7:metric(7,row.d7),d30:metric(30,row.d30)};
    });
    const retentionDataFrom=activityFloor._min.activityDate?.toISOString()??null;
    return{
      generatedAt:generatedAt.toISOString(),since:since.toISOString(),days,
      users:{registered:newUsers,active:activeUsers,payingUsers,registrationPaymentRate:paymentMetrics.newUserPaymentRate},
      engagement:{newConversations,userMessages,assistantMessages,visiblePosts,visibleComments,moderationActions},
      payments:{paidOrders,paidAmountCnyCents:paidTotals._sum.amountCnyCents??0,completedRefunds:refundTotals._count._all,refundedAmountCnyCents:refundTotals._sum.amountCnyCents??0},
      aiCosts,
      retention:{available:retentionDataFrom!==null,dataFrom:retentionDataFrom,cohorts:retentionCohorts},
      definitions:{
        activeUsers:'统计窗口内有活动记录且未注销/停用的账号；活动记录按账号最近活动时间计算。',
        retentionAvailable:retentionDataFrom!==null,
        grossMarginAvailable:false,
        grossMarginUnavailableReason:'模型成本资料、部分币种换算和支付通道费用尚未齐备，不计算毛利。',
      },
    };
  });
}
