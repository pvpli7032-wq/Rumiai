import type {SceneConfig} from './scene-config';
export function normalizeSceneCatalog(raw:unknown):SceneConfig[]{
 if(!Array.isArray(raw)||raw.length>100)throw Error('场景目录必须是数组，最多100个场景。');
 const ids=new Set<string>();
 return raw.map((item,index)=>{if(!item||typeof item!=='object'||Array.isArray(item))throw Error('场景格式不正确。');const r=item as Record<string,unknown>;
 const text=(key:string,max=4000,optional=false)=>{const value=typeof r[key]==='string'?(r[key] as string).trim():'';if((!optional&&!value)||value.length>max)throw Error('场景 '+(index+1)+' 的 '+key+' 为空或过长。');return value;};
 const id=text('id',100);if(ids.has(id)||!/^[-a-zA-Z0-9_]+$/.test(id))throw Error('场景标识只能使用字母数字和横线，且不能重复。');ids.add(id);
 if(typeof r.enabled!=='boolean')throw Error('场景启用状态必须为开或关。');
 const suggestions=Array.isArray(r.suggestions)?r.suggestions:[];if(suggestions.length>8)throw Error('场景建议最多8条。');const seen=new Set<string>();const items=suggestions.map((x:unknown)=>{if(!x||typeof x!=='object')throw Error('场景建议格式不正确。');const v=x as Record<string,unknown>;if(typeof v.id!=='string'||!v.id.trim()||seen.has(v.id)||typeof v.text!=='string'||!v.text.trim()||v.text.length>300)throw Error('场景建议需唯一标识和不超过300字的正文。');seen.add(v.id);return {id:v.id,text:v.text.trim()};});
 const compatibility=r.compatibility as Record<string,unknown>|undefined;if(!compatibility||typeof compatibility.approvedCharacterScenarioVersion!=='string'||!compatibility.approvedCharacterScenarioVersion.trim()||typeof compatibility.reviewedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(compatibility.reviewedAt))throw Error('请填写角色设定版本与审核日期。');
 const questions=Array.isArray(r.publicOpenQuestions)?r.publicOpenQuestions:[];if(questions.length>8||questions.some(x=>typeof x!=='string'||!x.trim()||x.length>300))throw Error('公开问题最多8条，每条不超过300字。');
 const minutes=r.estimatedMinutes===undefined?undefined:Number(r.estimatedMinutes);if(minutes!==undefined&&(!Number.isInteger(minutes)||minutes<1||minutes>240))throw Error('预计时长应为1至240分钟。');
 return {id,version:text('version',100),characterId:text('characterId',100),enabled:r.enabled,title:text('title',120),hook:text('hook'),userIdentity:text('userIdentity'),conflict:text('conflict'),goal:text('goal'),opening:text('opening',4000,true),imageUrl:text('imageUrl',2000,true),suggestions:items,publicOpenQuestions:questions as string[],...(minutes?{estimatedMinutes:minutes}:{}),compatibility:{approvedCharacterScenarioVersion:compatibility.approvedCharacterScenarioVersion,reviewedAt:compatibility.reviewedAt}};
 });
}
