import type {MirrorCharacterOption, MirrorCompareEntry, MirrorExampleView, MirrorOwnerResult, MirrorPublicResult, MirrorQuota} from '@rumiai/contracts/mirror/types';

export type MirrorRulesView = import('@rumiai/contracts/mirror/types').MirrorRules & {
  enabled: boolean;
  timezone: string;
  /** 观察风格说明：运营在设置中心写，直接拼进提示词，前台不展示。 */
  observationStyle: string;
  /** 新结果使用的版式；示例结果按它渲染。 */
  resultLayout: import('@rumiai/contracts/mirror/types').MirrorResultLayout;
};

/** 首页初始化接口的返回；与服务端 readPageView 的字段一一对应。 */
export type MirrorPageResponse = {
  characters: MirrorCharacterOption[];
  rules: MirrorRulesView;
  /** 按 questionCount 取好的提问文本；不足时页面明确提示待配置，不补默认题。 */
  questions: string[];
  quota: MirrorQuota;
  mine: {shareId: string; title: string; characterId: string; characterName: string; characterAvatarUrl: string | null; createdAt: string}[];
  /** 只含当前展示角色里配了示例的那些。 */
  examples: MirrorExampleView[];
  /** 运营一共配了几条示例。 */
  exampleCount: number;
};

export type MirrorGenerateResponse = {result: MirrorOwnerResult; quota: MirrorQuota};

export type MirrorView = {kind: 'public'; result: MirrorPublicResult} | {kind: 'owner'; result: MirrorOwnerResult};

/** 对比接口的返回：每条独立带状态，上限由服务端设置给出。 */
export type MirrorCompareResponse = {entries: MirrorCompareEntry[]; compareLimit: number};
