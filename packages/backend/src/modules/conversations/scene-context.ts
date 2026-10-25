import type {SceneConfig} from '@rumiai/contracts/stories/scene-config';
import {isSceneEntryComplete,resolveScene,type CharacterPublicFields} from '@rumiai/contracts/stories/scene-service';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
export class ConversationSceneError extends Error {}
export async function readSceneCatalog():Promise<SceneConfig[]>{const value=await readSettingValue('chat.scenes') as unknown;if(!Array.isArray(value))return [];return value.filter((item):item is SceneConfig=>{try{return item&&typeof item==='object'&&item.enabled===true&&isSceneEntryComplete(item);}catch{return false;}});}
export async function resolveConversationScene(character:CharacterPublicFields,sceneId:string|null|undefined):Promise<SceneConfig|null>{
 if(!sceneId)return null;const config=(await readSceneCatalog()).find(item=>item.id===sceneId);const resolved=resolveScene(character,config);
 if(resolved.kind!=='available')throw new ConversationSceneError('这个角色的场景已不可用，请返回角色页选择其他玩法。');
 return resolved.scene;
}
export function sceneContext(scene:SceneConfig|null):string|undefined{
 if(!scene)return undefined;
 return ['本段会话是独立的角色场景体验，以下是已审核场景设定，后续回复保持在此情境中，不混入其他对话或故事章节。','场景：'+scene.title,'开场情境：'+scene.hook,'用户身份：'+scene.userIdentity,'当前冲突与边界：'+scene.conflict,'本次目标：'+scene.goal,scene.opening?'开场背景：'+scene.opening:null,'结合用户的实际选择继续互动，不擅自声称目标已完成；不得将这些设定当作用户真实经历。'].filter(Boolean).join('\n');
}
