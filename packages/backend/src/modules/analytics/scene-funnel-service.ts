import {randomUUID} from 'node:crypto';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {checkRateLimit} from '@rumiai/backend/infrastructure/http/rate-limit';

/** V0 场景漏斗的四个节点。事件名即数据库存储值，客户端与服务端共用这份清单。 */
export const SCENE_FUNNEL_EVENTS=[
  'scene_opened',
  'scene_first_message_sent',
  'scene_active_end_confirmed',
  'scene_close_continue_clicked',
] as const;

export type SceneFunnelEventName=typeof SCENE_FUNNEL_EVENTS[number];

export class SceneFunnelError extends Error{
  constructor(message:string,public status=422){super(message);this.name='SceneFunnelError';}
}

const ID_MAX_LENGTH=64;

function validId(value:string){return value.length>0&&value.length<=ID_MAX_LENGTH;}

/**
 * 记录一条场景漏斗事实。幂等：同一用户同一会话同一事件最多一条（INSERT OR IGNORE）。
 * 只信任服务端能核验的事实：会话必须存在且属于该用户，防止伪造的会话标识污染漏斗。
 */
export async function recordSceneFunnelEvent(userId:string,input:{event:string;conversationId:string;sceneId:string}){
  if(!(SCENE_FUNNEL_EVENTS as readonly string[]).includes(input.event))throw new SceneFunnelError('未知的事件类型。');
  if(!validId(input.conversationId))throw new SceneFunnelError('会话标识无效。');
  if(!validId(input.sceneId))throw new SceneFunnelError('场景标识无效。');
  const rate=checkRateLimit(`scene-funnel:${userId}`,60,600_000);
  if(!rate.allowed)throw new SceneFunnelError('上报过于频繁，请稍后再试。',429);
  await pragmasReady;
  const conversation=await db.conversation.findUnique({where:{id:input.conversationId},select:{userId:true}});
  if(!conversation||conversation.userId!==userId)throw new SceneFunnelError('会话不存在。',404);
  await db.$executeRaw`INSERT OR IGNORE INTO scene_funnel_events (id,user_id,conversation_id,scene_id,event,created_at) VALUES (${randomUUID()},${userId},${input.conversationId},${input.sceneId},${input.event},${new Date()})`;
}
