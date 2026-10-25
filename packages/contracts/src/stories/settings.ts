export interface StorySceneSettings {
  playerIdentity: string;
  chapterGoal: string;
  sceneSupplement: string;
  narrativeStyle: string;
}
export interface StoryNarrativeStyle {key: string; label: string; instruction: string}
export const EMPTY_STORY_SCENE_SETTINGS: StorySceneSettings = {playerIdentity:'',chapterGoal:'',sceneSupplement:'',narrativeStyle:''};
export function readStoredStorySceneSettings(json?: string | null): StorySceneSettings {
  let value: Record<string,unknown> = {};
  try {const parsed=JSON.parse(json||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))value=parsed;} catch {}
  return Object.fromEntries(Object.keys(EMPTY_STORY_SCENE_SETTINGS).map(key=>[key,typeof value[key]==='string'?value[key]:''])) as unknown as StorySceneSettings;
}
export function validateStoryNarrativeStyles(input: unknown): string | null {
  if(!Array.isArray(input))return '故事叙事方式须为数组。';
  const ids=new Set<string>();
  for(const item of input){
    if(!item||typeof item!=='object'||Array.isArray(item))return '叙事方式格式不正确。';
    const value=item as Record<string,unknown>;
    if(Object.keys(value).some(key=>!['key','label','instruction'].includes(key))||typeof value.key!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(value.key)||typeof value.label!=='string'||!value.label.trim()||value.label.length>80||typeof value.instruction!=='string'||!value.instruction.trim()||value.instruction.length>4000)return '每项叙事方式须包含唯一key、名称和有效生成指令。';
    if(ids.has(value.key))return '叙事方式key不能重复。';ids.add(value.key);
  }
  return null;
}
