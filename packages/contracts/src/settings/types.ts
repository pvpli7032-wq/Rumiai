export type SettingType = 'number' | 'boolean' | 'string' | 'text' | 'json' | 'enum';
export type SettingGroup = 'chat' | 'billing' | 'growth' | 'accounts' | 'prompts';
export type SettingSource = 'USER' | 'GLOBAL' | 'DEFAULT';
export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

/**
 * 进程内设置缓存的有效期（毫秒）。
 *
 * 为什么放在这里：cache.ts 用它做过期判定，设置中心用它显示「其他后台进程最多
 * N 秒刷新」（V3 表 10「如何生效」）。两处必须同一个数，所以只有这一份字面量。
 */
export const SETTINGS_CACHE_TTL_MS = 15_000;

/** 一项设置的定义。registry 是唯一登记处：键名、分组、类型、默认值与校验范围都在这里。 */
export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  label: string;
  type: SettingType;
  /** 展示单位，例如「字」「次」「秒」「分钟」「天」「%」。 */
  unit?: string;
  default: JsonValue;
  min?: number;
  max?: number;
  /** number 类型是否允许小数。成本币这类量级很小的值必须开，否则最小粒度是 1 个币种单位。 */
  decimal?: boolean;
  options?: {value: string; label: string}[];
  description: string;
  /** 只有额度、计费模式、折扣倍率与指定玩法次数允许按用户覆盖。 */
  userOverridable: boolean;
  /** 设置中心默认折叠的高级项。 */
  advanced: boolean;
  /**
   * 不在设置中心展示。
   *
   * 值仍由本模块读写与校验（读取、保存、历史、恢复、导出导入都照常处理），
   * 只是因为它有另一个专属编辑位置，不在这里重复出现（V3 表 6「每项只在一个位置编辑」）。
   */
  hidden?: boolean;
}

export interface SettingValue {
  key: string;
  value: JsonValue;
  source: SettingSource;
  version: number;
  /** 用户特例的到期时间（仅 source=USER 时有值）。 */
  expiresAt?: string | null;
  /** 这一项的最近保存时间；来源是登记默认值时没有时间。 */
  updatedAt?: string | null;
}

export interface SettingChange {
  key: string;
  value: JsonValue;
}

export interface SaveGroupResult {
  saved: string[];
  versions: Record<string, number>;
}
