import type {Prisma} from '@prisma/client';

export type SettingType = 'number' | 'boolean' | 'string' | 'text' | 'json' | 'enum';
export type SettingGroup = 'chat' | 'billing' | 'growth' | 'accounts' | 'prompts';
export type SettingSource = 'USER' | 'GLOBAL' | 'DEFAULT';
export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

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
}

export interface SettingValue {
  key: string;
  value: JsonValue;
  source: SettingSource;
  version: number;
  /** 用户特例的到期时间（仅 source=USER 时有值）。 */
  expiresAt?: string | null;
}

export interface SettingChange {
  key: string;
  value: JsonValue;
}

export interface SaveGroupResult {
  saved: string[];
  versions: Record<string, number>;
}

type TxClient = Prisma.TransactionClient;
