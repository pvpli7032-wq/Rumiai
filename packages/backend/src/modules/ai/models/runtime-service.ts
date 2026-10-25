import {db} from '@rumiai/backend/infrastructure/database/client';
import {allowedModels} from '@rumiai/backend/modules/ai/ai-models';
import {decryptProviderSecret} from '@rumiai/backend/modules/ai/providers/secret';
import type {Prisma} from '@prisma/client';
import {readCharacterModelScope} from '@rumiai/backend/modules/characters/model-scope';

export type RuntimeAiModel={supportsChat?:boolean;supportsVision?:boolean;supportsTranscription?:boolean;key:string;displayName:string;modelCode:string;provider:{id:string;name:string;baseUrl:string;apiKey:string};timeoutMs:number;maxRetries:number;maxOutputTokens:number;isDefault:boolean;isFallback:boolean;sortOrder:number};

async function loadManagedModels(reader:Prisma.TransactionClient=db){
  if(!await reader.aiModel.count())return null;
  const rows=await reader.aiModel.findMany({where:{isActive:true,provider:{isActive:true}},include:{provider:{select:{id:true,name:true,baseUrl:true,secretCiphertext:true,secretNonce:true,secretTag:true}}},orderBy:[{isDefault:'desc'},{sortOrder:'asc'},{key:'asc'}],take:200});
  return rows.flatMap(row=>{try{return[{supportsChat:row.supportsChat,supportsVision:row.supportsVision,supportsTranscription:row.supportsTranscription,key:row.key,displayName:row.displayName,modelCode:row.modelCode,provider:{id:row.provider.id,name:row.provider.name,baseUrl:row.provider.baseUrl,apiKey:decryptProviderSecret(row.provider)},timeoutMs:row.timeoutMs,maxRetries:row.maxRetries,maxOutputTokens:row.maxOutputTokens,isDefault:row.isDefault,isFallback:row.isFallback,sortOrder:row.sortOrder} satisfies RuntimeAiModel];}catch{return[];}});
}

/** Metadata for character managers; never includes connection addresses or provider credentials. */
export async function readAiModelOptions(){
  const rows=await db.aiModel.findMany({select:{key:true,displayName:true,isActive:true,supportsChat:true,provider:{select:{isActive:true}}},orderBy:[{sortOrder:'asc'},{key:'asc'}],take:200});
  return rows.map(row=>({key:row.key,displayName:row.displayName,available:row.isActive&&row.provider.isActive&&row.supportsChat}));
}

export async function readAiModelCatalog(characterId?:string,reader:Prisma.TransactionClient=db){
  const scope=characterId?await readCharacterModelScope(characterId,reader):undefined;
  const managed=await loadManagedModels(reader);
  if(managed===null&&!scope?.restricted&&!(characterId&&!scope)){const models=allowedModels();return{source:'ENV' as const,models,labels:Object.fromEntries(models.map(model=>[model,model])),default:models[0]??null};}
  const usable=(managed??[]).filter(model=>model.supportsChat!==false).filter(model=>characterId&&!scope?false:!scope?.restricted||scope.modelKeys.includes(model.key));
  const models=usable.map(model=>model.key),defaultModel=usable.find(model=>model.isDefault)?.key??(scope?.restricted?usable[0]?.key:null)??null;
  return{source:'DATABASE' as const,models,labels:Object.fromEntries(usable.map(model=>[model.key,model.displayName])),default:defaultModel};
}

/** null uses environment routing; [] blocks execution, including when a character scope has no usable route. */
export async function readAiModelPlan(preferred?:string|null,characterId?:string,capability:'chat'|'vision'|'transcription'='chat'):Promise<RuntimeAiModel[]|null>{
  const scope=characterId?await readCharacterModelScope(characterId):undefined;
  if(characterId&&!scope||scope?.restricted&&preferred&&!scope.modelKeys.includes(preferred))return[];
  const managed=await loadManagedModels();if(managed===null)return scope?.restricted||capability!=='chat'?[]:null;
  const models=managed.filter(model=>capability==='vision'?model.supportsVision:capability==='transcription'?model.supportsTranscription:model.supportsChat!==false).filter(model=>!scope?.restricted||scope.modelKeys.includes(model.key));if(!models.length)return[];
  const defaultModel=models.find(model=>model.isDefault)??(scope?.restricted?models[0]:undefined),fallbacks=models.filter(model=>model.isFallback);
  const selected=preferred?models.find(model=>model.key===preferred):undefined;
  const chain:RuntimeAiModel[]=[];
  for(const model of [selected,defaultModel,...fallbacks])if(model&&!chain.some(item=>item.key===model.key))chain.push(model);
  return chain;
}
