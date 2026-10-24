import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {claimWriter,recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {GROWTH_MODULES,isGrowthModuleId,type GrowthModuleDescriptor,type GrowthModuleId} from '@rumiai/contracts/growth/modules';

export class GrowthModuleError extends Error{
  constructor(message:string,public status=400){super(message);this.name='GrowthModuleError';}
}

function parseConfig(descriptor:GrowthModuleDescriptor,value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthModuleError('玩法模块配置必须是对象。');
  const row=value as Record<string,unknown>,fields=new Map(descriptor.configSchema.fields.map(field=>[field.key,field]));
  if(!descriptor.configSchema.additionalProperties&&Object.keys(row).some(key=>!fields.has(key)))throw new GrowthModuleError('玩法模块配置包含未声明字段。');
  for(const field of descriptor.configSchema.fields){
    const current=row[field.key];
    if(current===undefined){if(field.required)throw new GrowthModuleError(`${field.label}不能为空。`);continue;}
    if(field.type==='boolean'&&typeof current!=='boolean')throw new GrowthModuleError(`${field.label}必须是开关值。`);
    if(field.type==='integer'&&(!Number.isSafeInteger(current)||(field.minimum!==undefined&&Number(current)<field.minimum)||(field.maximum!==undefined&&Number(current)>field.maximum)))throw new GrowthModuleError(`${field.label}数值无效。`);
    if(field.type==='string'&&(typeof current!=='string'||(field.maxLength!==undefined&&current.length>field.maxLength)))throw new GrowthModuleError(`${field.label}文本无效。`);
  }
  return row;
}

function descriptor(id:GrowthModuleId){return GROWTH_MODULES.find(item=>item.id===id)!;}
function parseStoredConfig(value:string){try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}}

export async function readGrowthModules(actor:string){
  await pragmasReady;
  return db.$transaction(async tx=>{
    if(!await hasAdminPermission(actor,'growth.read',tx))throw new GrowthModuleError('当前账号没有玩法模块查看权限。',403);
    const states=await tx.growthModuleState.findMany({where:{moduleId:{in:[...GROWTH_MODULES.map(item=>item.id)]}}});
    const byId=new Map(states.map(state=>[state.moduleId,state]));
    return {modules:GROWTH_MODULES.map(module=>{const state=byId.get(module.id);return {...module,isEnabled:state?.isEnabled??true,config:state?parseStoredConfig(state.configJson):{},version:state?.version??0,updatedAt:state?.updatedAt??null};})};
  });
}

export async function saveGrowthModule(actor:string,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new GrowthModuleError('玩法模块数据格式错误。');
  const body=input as Record<string,unknown>;
  if(!isGrowthModuleId(body.moduleId))throw new GrowthModuleError('玩法模块不存在。',404);
  if(typeof body.isEnabled!=='boolean')throw new GrowthModuleError('玩法模块启停状态无效。');
  if(!Number.isSafeInteger(body.version)||Number(body.version)<0)throw new GrowthModuleError('玩法模块版本无效，请刷新后重试。');
  if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>300)throw new GrowthModuleError('请填写 1–300 字操作理由。');
  const moduleId=body.moduleId,isEnabled=body.isEnabled,expectedVersion=Number(body.version),config=parseConfig(descriptor(moduleId),body.config??{}),reason=body.reason.trim();
  await pragmasReady;
  return db.$transaction(async tx=>{
    await claimWriter(tx,actor);
    if(!await hasAdminPermission(actor,'growth.manage',tx))throw new GrowthModuleError('当前账号没有玩法模块管理权限。',403);
    const before=await tx.growthModuleState.findUnique({where:{moduleId}});
    if((before?.version??0)!==expectedVersion)throw new GrowthModuleError('玩法模块已被其他操作修改，请刷新后重试。',409);
    const saved=await tx.growthModuleState.upsert({where:{moduleId},create:{moduleId,isEnabled,configJson:JSON.stringify(config),version:1,updatedBy:actor},update:{isEnabled,configJson:JSON.stringify(config),version:{increment:1},updatedBy:actor}});
    await recordAdminAudit(tx,actor,'SAVE_GROWTH_MODULE',moduleId,reason,{before:before?{isEnabled:before.isEnabled,config:parseStoredConfig(before.configJson),version:before.version}:null,after:{isEnabled:saved.isEnabled,config,version:saved.version}});
    return {moduleId,isEnabled:saved.isEnabled,config,version:saved.version,updatedAt:saved.updatedAt};
  });
}
