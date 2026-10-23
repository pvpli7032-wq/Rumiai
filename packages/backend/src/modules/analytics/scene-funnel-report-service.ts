import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';

export class SceneFunnelReportError extends Error{
  constructor(message:string,public status=400){super(message);this.name='SceneFunnelReportError';}
}

type EventCounts={opened:number;firstSent:number;activeEndConfirmed:number;continueClicked:number};

const rate=(numerator:number,denominator:number)=>denominator>0?numerator/denominator:null;

/**
 * V0 场景漏斗报表。只聚合 scene_funnel_events 的四类事实计数与比率，
 * 不输出用户或会话标识，与运营分析同权限（analytics.read）与同天数上限。
 */
export async function readSceneFunnelReport(actorId:string,days:number){
  if(!Number.isInteger(days)||days<1||days>90)throw new SceneFunnelReportError('统计天数必须为 1–90 的整数。');
  await pragmasReady;
  return db.$transaction(async tx=>{
    if(!await hasAdminPermission(actorId,'analytics.read',tx))throw new SceneFunnelReportError('当前账号没有运营分析权限。',403);
    const generatedAt=new Date(),since=new Date(generatedAt.getTime()-days*86400000);
    // 锚定口径：以「开场到达事件落在窗口内」的会话为漏斗分母。后续节点按
    // (user_id, conversation_id) 归属回这些会话，事件自身时间戳在窗口外也计入——
    // 否则跨窗口完成的会话会丢失分母或分子，比率可能超过 100%。幂等键
    // UNIQUE(user_id, conversation_id, event) 保证每会话每事件最多一条，无需再 DISTINCT。
    const [row]=await tx.$queryRaw<Array<{opened:number;firstSent:number;activeEndConfirmed:number;continueClicked:number}>>`
      SELECT COUNT(*) AS opened,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM scene_funnel_events f WHERE f.user_id=o.user_id AND f.conversation_id=o.conversation_id AND f.event='scene_first_message_sent') THEN 1 ELSE 0 END) AS firstSent,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM scene_funnel_events f WHERE f.user_id=o.user_id AND f.conversation_id=o.conversation_id AND f.event='scene_active_end_confirmed') THEN 1 ELSE 0 END) AS activeEndConfirmed,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM scene_funnel_events f WHERE f.user_id=o.user_id AND f.conversation_id=o.conversation_id AND f.event='scene_close_continue_clicked') THEN 1 ELSE 0 END) AS continueClicked
      FROM scene_funnel_events o
      WHERE o.event='scene_opened' AND o.created_at >= ${since} AND o.created_at <= ${generatedAt}
    `;
    const events:EventCounts={
      opened:Number(row?.opened??0),
      firstSent:Number(row?.firstSent??0),
      activeEndConfirmed:Number(row?.activeEndConfirmed??0),
      continueClicked:Number(row?.continueClicked??0),
    };
    return{
      generatedAt:generatedAt.toISOString(),since:since.toISOString(),days,
      events,
      rates:{
        firstMessageRate:rate(events.firstSent,events.opened),
        activeEndRate:rate(events.activeEndConfirmed,events.opened),
        activeEndRateAfterFirstMessage:rate(events.activeEndConfirmed,events.firstSent),
        continueClickRate:rate(events.continueClicked,events.activeEndConfirmed),
      },
      definitions:{
        opened:'开场到达事件落在统计窗口内的会话数（每用户每会话至多一条）。',
        anchor:'锚定窗口：分母只看开场到达的时间；后续节点发生在窗口外（会话跨窗口完成）同样计入，因此最近几天的漏斗天然偏向未完成，属预期。',
        firstMessageRate:'首条消息率 = 首条消息发出的会话数 / 开场到达的会话数。',
        activeEndRate:'主动结束率 = 结束确认的会话数 / 开场到达的会话数。',
        activeEndRateAfterFirstMessage:'主动结束率（首条消息口径）= 结束确认的会话数 / 首条消息发出的会话数。',
        continueClickRate:'继续点击率 = 回顾页继续点击的会话数 / 结束确认的会话数。',
      },
    };
  });
}
