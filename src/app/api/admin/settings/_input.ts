import {SETTINGS_BY_KEY, isUserOverridable, SettingValidationError} from '@/lib/settings';
import type {JsonValue, SettingChange} from '@/lib/settings';

/**
 * 设置请求体解析：只做形状与白名单校验，取值合法性交给 registry + validation，
 * 这样同一项设置在任何入口都只有一套校验规则。
 */
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function reject(key: string, message: string): never {
  throw new SettingValidationError(key, message);
}

export function isRegisteredKey(key: string): boolean {
  return KEY_PATTERN.test(key) && Object.hasOwn(SETTINGS_BY_KEY, key);
}

/** 一次请求里每项只能出现一次：重复会让单事务的第二条读到自己刚写的版本，直接版本冲突。 */
function uniqueKeys(items: unknown[], what: string): void {
  const seen = new Set<string>();
  for (const item of items as {key?: unknown}[]) {
    if (typeof item?.key !== 'string') continue;
    if (seen.has(item.key)) reject(item.key, '同一项' + what + '不能在一次保存里重复出现。');
    seen.add(item.key);
  }
}

/** changes：键必须已登记，且同一键只能出现一次。 */
export function parseChanges(raw: unknown): SettingChange[] {
  if (!Array.isArray(raw) || raw.length === 0) reject('', '请至少修改一项设置。');
  if (raw.length > 200) reject('', '一次保存的设置项过多。');
  uniqueKeys(raw, '设置');
  const changes: SettingChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) reject('', '设置项格式不正确。');
    const {key, value} = item as {key?: unknown; value?: unknown};
    if (typeof key !== 'string' || !isRegisteredKey(key)) reject(typeof key === 'string' ? key : '', '未登记的设置键。');
    changes.push({key, value: value as JsonValue});
  }
  return changes;
}

/** expectedVersions：可省略（表示不做并发校验），给了就必须是非负整数。 */
export function parseExpectedVersions(raw: unknown): Record<string, number> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) reject('', '设置版本信息格式不正确。');
  const versions: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isRegisteredKey(key)) reject(key, '未登记的设置键。');
    if (!Number.isSafeInteger(value) || (value as number) < 0) reject(key, '设置版本信息格式不正确。');
    versions[key] = value as number;
  }
  return versions;
}

export interface OverrideChange {
  key: string;
  value: JsonValue;
  expiresAt: string | null;
}

/** 用户特例：只允许登记表里标了 userOverridable 的项；到期时间可空，给了就必须是未来时刻。 */
export function parseOverrideChanges(raw: unknown, now = new Date()): OverrideChange[] {
  if (!Array.isArray(raw) || raw.length === 0) reject('', '请至少设置一项。');
  if (raw.length > 50) reject('', '一次保存的设置项过多。');
  uniqueKeys(raw, '设置');
  const changes: OverrideChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) reject('', '设置项格式不正确。');
    const {key, value, expiresAt} = item as {key?: unknown; value?: unknown; expiresAt?: unknown};
    if (typeof key !== 'string' || !isRegisteredKey(key)) reject(typeof key === 'string' ? key : '', '未登记的设置键。');
    if (!isUserOverridable(key)) reject(key, '该项不允许按用户覆盖。');
    let expires: string | null = null;
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
      if (typeof expiresAt !== 'string') reject(key, '到期时间格式不正确。');
      const at = new Date(expiresAt);
      if (!Number.isFinite(at.getTime())) reject(key, '到期时间格式不正确。');
      if (at <= now) reject(key, '到期时间必须晚于当前时间。');
      expires = at.toISOString();
    }
    changes.push({key, value: value as JsonValue, expiresAt: expires});
  }
  return changes;
}
