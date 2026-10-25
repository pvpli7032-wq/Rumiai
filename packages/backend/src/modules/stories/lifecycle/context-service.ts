import {readStoredStorySceneSettings} from '@rumiai/contracts/stories/settings';
import {readStorySettingsPolicy} from './settings-service';
import {StoryError} from '../repository/contracts';
import {readState} from '@rumiai/backend/modules/stories/lifecycle/state-model';
import {readVersion} from '@rumiai/backend/modules/stories/repository/contracts';

type StoryRunContextInput = {
  chapterKey: string;
  stateJson: string;
  settingsJson?: string;
  templateVersion: {definitionJson: string; characterSnapshotJson: string; template: {title: string}};
};

const MAX_CONTEXT_FACTS = 40;

/** Build a model-facing context from public fields only; never serialize the run. */
export function buildStoryContext(run: StoryRunContextInput, narrativeInstruction?: string): string {
  const settings=readStoredStorySceneSettings(run.settingsJson);
  const chapterKey = typeof run.chapterKey === 'string' && run.chapterKey.trim() ? run.chapterKey.trim() : '未知章节';
  const storyTitle = run.templateVersion.template.title;
  let chapterTitle = chapterKey;
  let publicSummary = '';

  try {
    const definition = readVersion(run.templateVersion.definitionJson, run.templateVersion.characterSnapshotJson);
    const chapter = definition.chapters.find(item => item.key === chapterKey);
    chapterTitle = chapter?.title ?? chapterKey;
    publicSummary = definition.publicSummary;
  } catch {
    // A damaged or incompatible template must not cause private JSON to enter the prompt.
  }

  const state = readState(run.stateJson);
  const facts = state?.facts ?? [];
  const omitted = Math.max(0, facts.length - MAX_CONTEXT_FACTS);
  const visibleFacts = facts.slice(-MAX_CONTEXT_FACTS);

  return [
    '故事背景',
    '故事：' + storyTitle,
    '当前章节：' + chapterTitle,
    '公开简介：' + (publicSummary || '暂无公开简介'),
    ...(settings.playerIdentity?['玩家身份（用户设定）：'+settings.playerIdentity]:[]),
    ...(settings.chapterGoal?['本次章节目标（意图，不代表已完成）：'+settings.chapterGoal]:[]),
    ...(settings.sceneSupplement?['场景补充（设定，不得冒充已经发生的事实）：'+settings.sceneSupplement]:[]),
    ...(narrativeInstruction?['叙事方式：'+narrativeInstruction]:[]),
    '已确认事实：',
    ...(visibleFacts.length ? visibleFacts.map((fact, index) => (omitted + index + 1) + '. ' + fact) : ['暂无已确认事实']),
    ...(omitted ? ['（较早事实已省略 ' + omitted + ' 条）'] : []),
    '固定规则：事实是已经发生的内容，不得改写；不得声称用户答应过未答应的事；用户行动由用户自己决定，不得代劳。',
  ].join('\n');
}

export async function buildConfiguredStoryContext(run:StoryRunContextInput):Promise<string>{
 const settings=readStoredStorySceneSettings(run.settingsJson);
 const policy=await readStorySettingsPolicy();
 const style=settings.narrativeStyle?policy.styles.find(item=>item.key===settings.narrativeStyle):null;
 if(settings.narrativeStyle&&!style)throw new StoryError('NARRATIVE_STYLE_UNAVAILABLE','所选叙事方式已下架，请在故事场景设置重新选择。',422);
 return buildStoryContext(run,style?.instruction);
}
