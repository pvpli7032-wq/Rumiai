/**
 * Reviewed, versioned scene copy shipped with the application.
 * This is static release configuration, not a database and not model-generated.
 */
export type SceneSuggestion = Readonly<{id: string; text: string}>;

export type SceneConfig = Readonly<{
  id: string;
  version: string;
  characterId: string;
  enabled: boolean;
  title: string;
  hook: string;
  userIdentity: string;
  conflict: string;
  goal: string;
  opening?: string;
  publicOpenQuestions?: readonly string[];
  imageUrl?: string;
  estimatedMinutes?: number;
  suggestions: readonly SceneSuggestion[];
  compatibility: Readonly<{
    approvedCharacterScenarioVersion: string;
    reviewedAt: string;
  }>;
}>;

/** Public, reviewed scene copy for the three real launch characters. */
export const SCENE_CONFIGS: readonly SceneConfig[] = [
  {
    id: 'midnight-studio-melody-ch01',
    version: 'v0.1.0',
    characterId: 'xingban-original-4',
    enabled: true,
    title: '深夜工作室：一段没发出去的旋律',
    hook: '墨白在深夜工作室反复修改一段旋律，却始终没有按下发送。',
    userIdentity: '你是被墨白请来听听这段未完成旋律的人。',
    conflict: '墨白还没决定是否想听反馈；旋律背后的来历由墨白自己选择要不要谈。',
    goal: '先问墨白想听哪种反馈，再一起选一个下一步：保留、修改，或暂缓发送。',
    opening: '你今天的心情，会是什么旋律？今晚，墨白把一段没有发出去的旋律放给你听。',
    publicOpenQuestions: ['这段旋律想保留哪一种感觉？', '墨白希望先修改一处，还是暂时放一放？'],
    estimatedMinutes: 10,
    suggestions: [
      {id: 'listen-without-explanation', text: '先听完旋律，不急着问背景'},
      {id: 'ask-if-willing-to-talk', text: '问墨白想不想聊这段旋律为何暂未发送'},
      {id: 'ask-before-feedback', text: '先问墨白是否愿意听我对旋律的感受'},
    ],
    compatibility: {approvedCharacterScenarioVersion: 'xingban-original-4-scenario-v1', reviewedAt: '2026-10-20'},
  },
  {
    id: 'greenhouse-anomalous-leaf-ch01',
    version: 'v0.1.0',
    characterId: 'xingban-original-3',
    enabled: true,
    title: '温室里一株叶子异常的植物',
    hook: '知夏发现温室里一株植物的新叶长得不太一样，正在记录变化。',
    userIdentity: '你是来温室帮知夏做一次细致观察的人。',
    conflict: '异常可能来自环境、照料方式或尚未确认的因素，贸然处理可能掩盖真正原因。',
    goal: '和知夏先记下叶片两项可见变化，并选定一项不改变照料的后续观察。',
    opening: '新长出来的叶子，也值得认真庆祝。今天，温室里有一株植物需要你一起观察。',
    publicOpenQuestions: ['接下来可以核对哪一项可见变化？', '在原因未明时，是否先保持现有照料并继续观察？'],
    estimatedMinutes: 10,
    suggestions: [
      {id: 'describe-leaf-carefully', text: '先描述你看到的叶片变化'},
      {id: 'check-growing-conditions', text: '一起检查光照和湿度记录'},
      {id: 'observe-before-changing', text: '先不调整照料，选定下次要对照的特征'},
    ],
    compatibility: {approvedCharacterScenarioVersion: 'xingban-original-3-scenario-v1',reviewedAt: '2026-10-20'},
  },
  {
    id: 'bookshop-old-letter-ch01',
    version: 'v0.1.0',
    characterId: 'xingban-original-5',
    enabled: true,
    title: '闭店后的旧信',
    hook: '映雪在闭店后的书店里发现一本夹着旧信的书，信的收件人没有写全。',
    userIdentity: '你是闭店后留下来帮映雪整理书架的人。',
    conflict: '这封信可能包含他人的私人内容；在映雪确认处理方式前，不拆阅、不抄录、不传播，也不推测收件人身份。',
    goal: '和映雪先决定让信保持原状，并由映雪确认后续处理方式；本次不查找或推测收件人身份。',
    opening: '来挑一本书吧，我们可以一起寻找故事里的线索。闭店后，映雪在一本书里发现了一封旧信。',
    publicOpenQuestions: ['映雪确认处理方式前，怎样让信保持原状？', '映雪准备怎样在不查看信件内容的前提下妥善处理它？'],
    estimatedMinutes: 10,
    suggestions: [
      {id: 'record-letter-location', text: '先记录书和信被发现的位置'},
      {id: 'read-only-visible-clues', text: '先不查看信件内容，问映雪希望如何处理'},
      {id: 'keep-letter-unchanged', text: '先保留原状，暂不拆开信件'},
    ],
    compatibility: {approvedCharacterScenarioVersion: 'xingban-original-5-scenario-v1',reviewedAt: '2026-10-20'},
  },
] as const;

export function getSceneConfigByCharacterId(id: string): SceneConfig | undefined {
  return SCENE_CONFIGS.find(scene => scene.characterId === id);
}