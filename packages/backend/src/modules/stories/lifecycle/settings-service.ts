import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings';
import {StoryError} from '../repository/contracts';
import {requireVisibleRun,requirePublishedTemplate,view} from '../repository/run-service';
import {EMPTY_STORY_SCENE_SETTINGS,readStoredStorySceneSettings,validateStoryNarrativeStyles,type StorySceneSettings,type StoryNarrativeStyle} from '@rumiai/contracts/stories/settings';

export async function readStorySettingsPolicy(){
 const [maxChars,raw]=await Promise.all([readSettingValue<number>('story.settingsMaxChars'),readSettingValue('story.narrativeStyles')]);
 if(validateStoryNarrativeStyles(raw))throw new StoryError('INVALID_SETTINGS_POLICY','故事叙事配置暂不可用，请联系管理员。',503);
 return {maxChars,styles:raw as unknown as StoryNarrativeStyle[]};
}
export async function readStorySceneSettings(userId:string,runId:string){
 const [run,policy]=await Promise.all([requireVisibleRun(db,userId,runId),readStorySettingsPolicy()]);
 return {revision:run.revision,status:run.status,settings:readStoredStorySceneSettings(run.settingsJson),policy:{maxChars:policy.maxChars,styles:policy.styles.map(({key,label})=>({key,label}))}};
}
export async function updateStorySceneSettings(userId:string,runId:string,input:unknown){
 const body=input as {expectedRevision?:unknown;settings?:unknown}|null,policy=await readStorySettingsPolicy();
 if(!body||!Number.isInteger(body.expectedRevision)||!body.settings||typeof body.settings!=='object'||Array.isArray(body.settings))throw new StoryError('INVALID_SETTINGS','请提供当前故事版本和场景设定。',422);
 const raw=body.settings as Record<string,unknown>,settings={...EMPTY_STORY_SCENE_SETTINGS};
 if(Object.keys(raw).some(key=>!(key in settings)))throw new StoryError('INVALID_SETTINGS','包含不支持的故事设定。',422);
 for(const key of Object.keys(settings) as Array<keyof StorySceneSettings>){
  const value=raw[key];if(typeof value!=='string'||value.length>policy.maxChars)throw new StoryError('INVALID_SETTINGS','每项场景设定须为文本，最多'+policy.maxChars+'字。',422);settings[key]=value.trim();
 }
 if(settings.narrativeStyle&&!policy.styles.some(item=>item.key===settings.narrativeStyle))throw new StoryError('NARRATIVE_STYLE_UNAVAILABLE','所选叙事方式已下架，请重新选择或使用故事默认。',422);
 return db.$transaction(async tx=>{
  const run=await requireVisibleRun(tx,userId,runId);requirePublishedTemplate(run);
  if(run.activeTurnId)throw new StoryError('TURN_IN_PROGRESS','当前回合正在生成，请结束后保存场景设定。',409);
  if(run.status!=='ACTIVE')throw new StoryError('RUN_NOT_ACTIVE','请先继续故事后修改场景设定。',409);
  const result=await tx.storyRun.updateMany({where:{id:runId,userId,revision:body.expectedRevision as number,activeTurnId:null},data:{settingsJson:JSON.stringify(settings),revision:{increment:1}}});
  if(!result.count)throw new StoryError('REVISION_CONFLICT','故事已有更新；当前编辑仍保留，请重新读取后保存。',409);
  return {run:await view(tx,await requireVisibleRun(tx,userId,runId))};
 });
}
