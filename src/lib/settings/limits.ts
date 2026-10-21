import {readSettings} from './service';
import type {JsonValue, SettingValue} from './types';

/**
 * 业务域读取设置的分组入口。
 *
 * 为什么集中在这里：一个请求要读四五项设置，逐个 await 会让代码里散落一堆
 * readSettingValue；按组读一次 readSettings 既走同一份 15 秒缓存，也让「哪个域读哪些键」
 * 只有一处声明。**不要**把结果缓存成模块顶层常量（V3 表 10：不能导出为启动时求值的常量）。
 */

async function readGroupValues(keys: string[]): Promise<Map<string, JsonValue>> {
  const values: SettingValue[] = await readSettings(keys);
  return new Map(values.map(item => [item.key, item.value]));
}

function num(map: Map<string, JsonValue>, key: string, fallback: number): number {
  const value = map.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function text(map: Map<string, JsonValue>, key: string, fallback: string): string {
  const value = map.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export interface ChatRules {
  /** 单条输入字数上限。 */
  maxMessageChars: number;
  /** 生成时携带的历史消息条数。 */
  historyMessages: number;
  /** 每窗口发送次数。 */
  perWindow: number;
  /** 窗口长度（毫秒），设置里以秒存。 */
  windowMs: number;
}

export async function readChatRules(): Promise<ChatRules> {
  const map = await readGroupValues(['chat.maxMessageChars', 'chat.historyMessages', 'limits.chat.perWindow', 'limits.chat.windowSeconds']);
  return {
    maxMessageChars: num(map, 'chat.maxMessageChars', 5000),
    historyMessages: num(map, 'chat.historyMessages', 20),
    perWindow: num(map, 'limits.chat.perWindow', 30),
    windowMs: num(map, 'limits.chat.windowSeconds', 60) * 1000,
  };
}

export interface CommunityRules {
  postMaxChars: number;
  commentMaxChars: number;
  postMaxImages: number;
  postPerWindow: number;
  postWindowMs: number;
  commentPerWindow: number;
  commentWindowMs: number;
}

export async function readCommunityRules(): Promise<CommunityRules> {
  const map = await readGroupValues([
    'content.post.maxChars', 'content.comment.maxChars', 'content.post.maxImages',
    'limits.post.perWindow', 'limits.post.windowSeconds', 'limits.comment.perWindow', 'limits.comment.windowSeconds',
  ]);
  return {
    postMaxChars: num(map, 'content.post.maxChars', 5000),
    commentMaxChars: num(map, 'content.comment.maxChars', 2000),
    postMaxImages: num(map, 'content.post.maxImages', 4),
    postPerWindow: num(map, 'limits.post.perWindow', 10),
    postWindowMs: num(map, 'limits.post.windowSeconds', 600) * 1000,
    commentPerWindow: num(map, 'limits.comment.perWindow', 20),
    commentWindowMs: num(map, 'limits.comment.windowSeconds', 600) * 1000,
  };
}

export interface CharacterContentLimits {
  name: number;
  tagline: number;
  personality: number;
  background: number;
  greeting: number;
  scenario: number;
}

export async function readCharacterContentLimits(): Promise<CharacterContentLimits> {
  const map = await readGroupValues([
    'content.character.nameMax', 'content.character.summaryMax', 'content.character.personaMax',
    'content.character.backgroundMax', 'content.character.openingMax',
  ]);
  const opening = num(map, 'content.character.openingMax', 2000);
  return {
    name: num(map, 'content.character.nameMax', 40),
    tagline: num(map, 'content.character.summaryMax', 100),
    personality: num(map, 'content.character.personaMax', 1000),
    background: num(map, 'content.character.backgroundMax', 8000),
    greeting: opening,
    // 开场白与场景描述共用一项设置（registry 说明里已写明）。
    scenario: opening,
  };
}

export async function readUploadMaxBytes(): Promise<number> {
  const map = await readGroupValues(['upload.maxMB']);
  return num(map, 'upload.maxMB', 8) * 1024 * 1024;
}

export interface RegistrationRules {
  passwordMinLength: number;
  signupBonusCoins: number;
}

export async function readRegistrationRules(): Promise<RegistrationRules> {
  const map = await readGroupValues(['accounts.passwordMinLength', 'grant.signupBonusCoins']);
  return {
    passwordMinLength: num(map, 'accounts.passwordMinLength', 6),
    signupBonusCoins: num(map, 'grant.signupBonusCoins', 100),
  };
}

export interface DailyRequestRules {
  /** 含免费与付费的每日请求总数；0 表示暂停新请求，不是无限。 */
  hardDailyMessages: number;
  /** 日额度切换时区。 */
  timezone: string;
}

export async function readDailyRequestRules(): Promise<DailyRequestRules> {
  const map = await readGroupValues(['billing.hardDailyMessages', 'billing.dayTimezone']);
  return {
    hardDailyMessages: num(map, 'billing.hardDailyMessages', 200),
    timezone: text(map, 'billing.dayTimezone', 'UTC'),
  };
}
