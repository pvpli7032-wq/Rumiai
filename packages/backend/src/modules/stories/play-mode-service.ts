import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings';
import {readVersion} from './repository/contracts';
import {readSceneCatalog} from '@rumiai/backend/modules/conversations/scene-context';
import {resolveScene} from '@rumiai/contracts/stories/scene-service';
import type {StoryPlayModes} from '@rumiai/contracts/stories/play-modes';
export async function readStoryPlayModes(userId:string|null,characterId:string|null):Promise<StoryPlayModes>{
 const character=characterId?await db.character.findFirst({where:{id:characterId,OR:[...(userId?[{creatorId:userId}]:[]),{isPublic:true,reviewStatus:'APPROVED'}]}}):null;
 const sceneResult=character?resolveScene(character,(await readSceneCatalog()).find(scene=>scene.characterId===character.id)):null;
 const scene=sceneResult?.kind==='available'?sceneResult.scene:null;
 const enabled=await readSettingValue<boolean>('story.enabled');
 const versions=character?await db.storyTemplateVersion.findMany({where:{publishedAt:{lte:new Date()},template:{status:'PUBLISHED'},characterSnapshotJson:{contains:character.id}},include:{template:{select:{slug:true}}},orderBy:[{publishedAt:'desc'},{version:'desc'}]}):[];
 const chapter=versions.find(version=>{try{return readVersion(version.definitionJson,version.characterSnapshotJson).characterId===character?.id;}catch{return false;}});
 const storyReason=!enabled?'章节故事尚未开放。':process.env.STORY_RUNS_DISABLED?.trim()==='1'?'章节故事新开已暂停；已有故事仍可查看。':process.env.STORY_TURNS_DISABLED?.trim()==='1'?'章节故事新回合已暂停。':!character?'请先选择角色。':!chapter?'当前角色暂无已发布的章节故事。':null;
 return {characterId:character?.id??null,scene:scene?{title:scene.title,hook:scene.hook,userIdentity:scene.userIdentity,goal:scene.goal}:null,modes:[
  {key:'chat',label:'角色对话',available:Boolean(character),reason:character?null:'请先选择可访问的角色。',href:character?'/chat?character='+encodeURIComponent(character.id)+'&new=1':null,description:'以角色身份进行自由对话。'},
  {key:'scene',sceneId:scene?.id??null,label:'场景对话',available:Boolean(scene),reason:scene?null:!character?'请先选择角色。':'当前角色暂无已开放的场景。',href:scene?'/chat?character='+encodeURIComponent(character!.id)+'&scene=1&new=1':null,description:'带着明确身份与场景目标进入对话。'},
  {key:'chapter',label:'章节故事',available:!storyReason,reason:storyReason,href:!storyReason&&chapter?'/stories/'+encodeURIComponent(chapter.template.slug):null,description:'按章节推进，支持事实回顾、存档和新分支。'}
 ]};
}
