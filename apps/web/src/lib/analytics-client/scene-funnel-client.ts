/**
 * V0 场景漏斗埋点的浏览器端上报。
 *
 * 设计约束：
 * - 静默失败：埋点永远不能干扰聊天，任何网络错误都被吞掉。
 * - keepalive：页面在事件触发后可能立刻跳转，请求必须能脱离页面生命周期存活。
 * - 幂等交给服务端：同一会话同一事件重复上报只落一条事实，客户端不做本地状态。
 */
import {API} from '@rumiai/contracts/api-paths';

export const SCENE_FUNNEL_EVENTS=[
  'scene_opened',
  'scene_first_message_sent',
  'scene_active_end_confirmed',
  'scene_close_continue_clicked',
] as const;

export type SceneFunnelEventName=typeof SCENE_FUNNEL_EVENTS[number];

export type SceneFunnelTarget={
  conversationId:string;
  sceneId:string;
};

export function trackSceneFunnelEvent(token:string|null|undefined,event:SceneFunnelEventName,target:SceneFunnelTarget):void{
  if(!token)return;
  void fetch(API.analytics.funnelEvents,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({event,conversationId:target.conversationId,sceneId:target.sceneId}),
    keepalive:true,
  }).catch(()=>{});
}
