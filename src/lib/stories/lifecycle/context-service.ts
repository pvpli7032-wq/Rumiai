import {readState} from './state-model';
import {readVersion} from '../repository/contracts';

type StoryRunContextInput = {
  chapterKey: string;
  stateJson: string;
  templateVersion: {definitionJson: string; characterSnapshotJson: string; template: {title: string}};
};

const MAX_CONTEXT_FACTS = 40;

/** Build a model-facing context from public fields only; never serialize the run. */
export function buildStoryContext(run: StoryRunContextInput): string {
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
    '已确认事实：',
    ...(visibleFacts.length ? visibleFacts.map((fact, index) => (omitted + index + 1) + '. ' + fact) : ['暂无已确认事实']),
    ...(omitted ? ['（较早事实已省略 ' + omitted + ' 条）'] : []),
    '固定规则：事实是已经发生的内容，不得改写；不得声称用户答应过未答应的事；用户行动由用户自己决定，不得代劳。',
  ].join('\n');
}
