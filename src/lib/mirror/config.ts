import {readSettings} from '@/lib/settings/service';
import {normalizeTimezone} from './limits';
import {MIRROR_SETTINGS, type MirrorOverLimitPolicy, type MirrorRules} from './types';

/** 一次请求需要的全部设置；同一次生成里只读一次列表，不反复查库。 */
export type MirrorConfig = MirrorRulesView & {
  /** Cookie 通道的匿名日次数。 */
  anonymousDailyLimit: number;
  /** IP 通道的匿名日次数；0 表示禁止匿名生成。 */
  anonymousIpDailyLimit: number;
  userDailyLimit: number;
  /** 后台指定的推广角色 id 列表；空表示按热度自动选取。 */
  featuredCharacterIds: string[];
  overLimitPolicy: MirrorOverLimitPolicy;
  /** 购买次数：开关、每次币价、每日购买上限。 */
  purchaseEnabled: boolean;
  purchaseCoins: number;
  purchaseDailyCap: number;
  template: string;
};

/** 对外只暴露展示需要的规则，提示词模板不带到前台。 */
export type MirrorRulesView = MirrorRules & {enabled: boolean; timezone: string};

export function toRulesView(config: MirrorConfig): MirrorRulesView {
  return {
    enabled: config.enabled,
    questionCount: config.questionCount,
    answerMaxChars: config.answerMaxChars,
    titleMaxChars: config.titleMaxChars,
    observationMaxChars: config.observationMaxChars,
    quoteMaxChars: config.quoteMaxChars,
    compareLimit: config.compareLimit,
    resultRetentionDays: config.resultRetentionDays,
    timezone: config.timezone,
  };
}

export async function readConfigFor(userId: string | null): Promise<MirrorConfig> {
  const values = await readSettings([...Object.values(MIRROR_SETTINGS), 'billing.dayTimezone'], userId);
  const byKey = new Map(values.map(item => [item.key, item.value]));
  const number = (key: string, fallback: number) => {
    const value = byKey.get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  /** json 型设置：只认字符串数组，非字符串项直接丢掉，不让坏数据把名单整体废掉。 */
  const stringList = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()) : []);
  return {
    enabled: byKey.get(MIRROR_SETTINGS.enabled) !== false,
    questionCount: number(MIRROR_SETTINGS.questionCount, 3),
    answerMaxChars: number(MIRROR_SETTINGS.answerMaxChars, 60),
    titleMaxChars: number(MIRROR_SETTINGS.titleMaxChars, 8),
    observationMaxChars: number(MIRROR_SETTINGS.observationMaxChars, 40),
    quoteMaxChars: number(MIRROR_SETTINGS.quoteMaxChars, 30),
    compareLimit: number(MIRROR_SETTINGS.compareLimit, 3),
    resultRetentionDays: number(MIRROR_SETTINGS.resultRetentionDays, 30),
    anonymousDailyLimit: number(MIRROR_SETTINGS.anonymousDailyLimit, 1),
    anonymousIpDailyLimit: number(MIRROR_SETTINGS.anonymousIpDailyLimit, 10),
    userDailyLimit: number(MIRROR_SETTINGS.userDailyLimit, 3),
    featuredCharacterIds: stringList(byKey.get(MIRROR_SETTINGS.featuredCharacterIds)),
    overLimitPolicy: byKey.get(MIRROR_SETTINGS.overLimitPolicy) === 'CHARGE' ? 'CHARGE' : 'PAUSE',
    purchaseEnabled: byKey.get(MIRROR_SETTINGS.purchaseEnabled) === true,
    purchaseCoins: number(MIRROR_SETTINGS.purchaseCoins, 0),
    purchaseDailyCap: number(MIRROR_SETTINGS.purchaseDailyCap, 0),
    template: String(byKey.get(MIRROR_SETTINGS.prompt) ?? ''),
    timezone: normalizeTimezone(String(byKey.get('billing.dayTimezone') ?? 'UTC')),
  };
}

export async function readMirrorRules(userId: string | null = null): Promise<MirrorRulesView> {
  return toRulesView(await readConfigFor(userId));
}
