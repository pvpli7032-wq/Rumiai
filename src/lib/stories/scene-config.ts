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
    conflict: '这段旋律可能只需要一次诚实的反馈，也可能牵涉一段不适合替别人解释的经历。',
    goal: '和墨白判断这段旋律要保留、修改，还是暂时不发出去。',
    opening: '你今天的心情，会是什么旋律？今晚，墨白把一段没有发出去的旋律放给你听。',
    publicOpenQuestions: ['这段旋律要不要发给原本的收件人？', '墨白愿意公开多少创作背景？'],
    estimatedMinutes: 10,
    suggestions: [
      {id: 'listen-without-explanation', text: '先听完旋律，不急着问背景'},
      {id: 'ask-what-stopped-send', text: '问问是什么让你没有发出去'},
      {id: 'offer-honest-feedback', text: '说说我听到的情绪和建议'},
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
    goal: '和知夏记录现象、排除可见因素，再决定是否调整照料或继续观察。',
    opening: '新长出来的叶子，也值得认真庆祝。今天，温室里有一株植物需要你一起观察。',
    publicOpenQuestions: ['这片叶子的变化来自哪里？', '现在应该调整照料，还是先保留观察记录？'],
    estimatedMinutes: 10,
    suggestions: [
      {id: 'describe-leaf-carefully', text: '先描述你看到的叶片变化'},
      {id: 'check-growing-conditions', text: '一起检查光照和湿度记录'},
      {id: 'observe-before-changing', text: '先不改变照料，继续观察一天'},
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
    conflict: '旧信提供了线索，却也属于尚未确认可以公开的私人内容。',
    goal: '和映雪决定如何保管这封信、查找线索，并尊重未知收件人的边界。',
    opening: '来挑一本书吧，我们可以一起寻找故事里的线索。闭店后，映雪在一本书里发现了一封旧信。',
    publicOpenQuestions: ['这封信应该由谁保管？', '在确认来历前，可以查到什么程度？'],
    estimatedMinutes: 10,
    suggestions: [
      {id: 'record-letter-location', text: '先记录书和信被发现的位置'},
      {id: 'read-only-visible-clues', text: '只查看信封上可见的线索'},
      {id: 'keep-letter-unchanged', text: '先保留原状，暂不拆开信件'},
    ],
    compatibility: {approvedCharacterScenarioVersion: 'xingban-original-5-scenario-v1',reviewedAt: '2026-10-20'},
  },
] as const;

export function getSceneConfigByCharacterId(id: string): SceneConfig | undefined {
  return SCENE_CONFIGS.find(scene => scene.characterId === id);
}
