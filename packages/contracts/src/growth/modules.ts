/**
 * Declarative contract for built-in growth modules.
 *
 * Only identifiers, permissions, menus and JSON config fields cross this boundary.
 * Runtime adapters stay in the backend; no database value can name executable code.
 */
export const GROWTH_MODULE_IDS=['missions','checkin','gifts'] as const;
export type GrowthModuleId=typeof GROWTH_MODULE_IDS[number];

export interface GrowthConfigField{
  key:string;
  type:'boolean'|'integer'|'string';
  label:string;
  required:boolean;
  minimum?:number;
  maximum?:number;
  maxLength?:number;
}

export interface GrowthModuleDescriptor{
  id:GrowthModuleId;
  label:string;
  description:string;
  menu:{adminTab:string;publicHref:string|null};
  permissions:{read:'growth.read';manage:'growth.manage'};
  configSchema:{version:1;additionalProperties:false;fields:readonly GrowthConfigField[]};
  taskTypes:readonly string[];
  eventTypes:readonly string[];
}

export const GROWTH_MODULES:readonly GrowthModuleDescriptor[]=[
  {id:'missions',label:'任务',description:'依据站内事实核验任务并领取奖励。',menu:{adminTab:'missions',publicHref:'/missions'},permissions:{read:'growth.read',manage:'growth.manage'},configSchema:{version:1,additionalProperties:false,fields:[]},taskTypes:['MISSION_PROGRESS'],eventTypes:['CHECKIN_COMPLETED','MESSAGE_COMPLETED','POST_CREATED','COMMENT_CREATED']},
  {id:'checkin',label:'签到',description:'每日签到、连续天数与奖励发放。',menu:{adminTab:'checkin',publicHref:null},permissions:{read:'growth.read',manage:'growth.manage'},configSchema:{version:1,additionalProperties:false,fields:[]},taskTypes:['CHECKIN_CLAIM'],eventTypes:['CHECKIN_CLAIMED']},
  {id:'gifts',label:'礼物',description:'站内礼物目录、扣币与赠送历史。',menu:{adminTab:'gifts',publicHref:null},permissions:{read:'growth.read',manage:'growth.manage'},configSchema:{version:1,additionalProperties:false,fields:[]},taskTypes:['GIFT_SEND'],eventTypes:['GIFT_SENT']},
] as const;

export function isGrowthModuleId(value:unknown):value is GrowthModuleId{
  return typeof value==='string'&&(GROWTH_MODULE_IDS as readonly string[]).includes(value);
}
