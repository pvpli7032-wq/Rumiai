import {db} from '@rumiai/backend/infrastructure/database/client';
import {SETTINGS_BY_KEY, definitionsOfGroup, isUserOverridable} from '@rumiai/contracts/settings/registry';
import {PUBLIC_KEYS} from '@rumiai/contracts/settings/public-keys';
import {cacheKey, clearKeyEverywhere, readCache, writeCache} from '@rumiai/backend/modules/settings/cache';
import {normalizeSettingValue, parseStoredValue, serializeSettingValue, SettingValidationError} from '@rumiai/contracts/settings/validation';
import type {JsonValue, SaveGroupResult, SettingChange, SettingDefinition, SettingGroup, SettingValue} from '@rumiai/contracts/settings/types';

/**
 * 设置中心读写。
 *
 * 优先级：有效用户特例 > 公共值 > 登记默认值（V3 §11）。
 * 读取结果带 value / source / version，界面默认只显示值。
 * 保存按分组单事务，带版本号防并发覆盖。
 */

export class SettingConflictError extends Error {
  constructor(readonly key: string) {
    super('设置已被其他管理员修改，请刷新后重试。');
    this.name = 'SettingConflictError';
  }
}

function toSettingValue(def: SettingDefinition, value: JsonValue, source: SettingValue['source'], version: number, expiresAt?: Date | null, updatedAt?: Date | null): SettingValue {
  return {
    key: def.key, value, source, version,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

async function readOne(userId: string | null | undefined, key: string): Promise<SettingValue> {
  const def = SETTINGS_BY_KEY[key];
  if (!def) throw new Error('未登记的设置键：' + key);
  const memoKey = cacheKey(userId, key);
  const hit = readCache(memoKey);
  if (hit) return {key, value: hit.value, source: hit.source, version: hit.version, expiresAt: hit.expiresAt, updatedAt: hit.updatedAt};

  const now = new Date();
  const [override, row] = await Promise.all([
    userId && isUserOverridable(key)
      ? db.userSettingOverride.findUnique({where: {userId_key: {userId, key}}})
      : Promise.resolve(null),
    db.operationSetting.findUnique({where: {key}}),
  ]);

  let result: SettingValue;
  if (override && (!override.expiresAt || override.expiresAt > now)) {
    result = toSettingValue(def, parseStoredValue(def, override.value), 'USER', override.version, override.expiresAt, override.updatedAt);
  } else if (row) {
    result = toSettingValue(def, parseStoredValue(def, row.value), 'GLOBAL', row.version, null, row.updatedAt);
  } else {
    // 登记默认值没有保存记录，也就没有更新时间。
    result = toSettingValue(def, def.default, 'DEFAULT', 0, null, null);
  }
  writeCache(memoKey, {value: result.value, source: result.source, version: result.version, expiresAt: result.expiresAt ?? null, updatedAt: result.updatedAt ?? null});
  return result;
}

export function readSetting(key: string, userId?: string | null): Promise<SettingValue> {
  return readOne(userId, key);
}

/** 业务代码只需要值，不关心来源与版本时用这个。 */
export async function readSettingValue<T extends JsonValue = JsonValue>(key: string, userId?: string | null): Promise<T> {
  const setting = await readOne(userId, key);
  return setting.value as T;
}

export function readSettings(keys: string[], userId?: string | null): Promise<SettingValue[]> {
  return Promise.all(keys.map(key => readOne(userId, key)));
}

export function readGroup(group: SettingGroup, userId?: string | null): Promise<SettingValue[]> {
  return readSettings(definitionsOfGroup(group).map(def => def.key), userId);
}

/** 前台只取自己需要的规则；白名单在 public-keys.ts，客户端与服务端共用一份。 */
export async function readPublicUiConfig(): Promise<Record<string, JsonValue>> {
  const values = await readSettings([...PUBLIC_KEYS]);
  return Object.fromEntries(values.map(item => [item.key, item.value]));
}

/**
 * 写入一批设置：跨分组、单事务，任何一项版本冲突都整体回滚。
 *
 * 这是唯一的写入口 —— 分组的 PATCH 与「导入确认」都走这里，
 * 校验规则、版本检查与历史记录只存在一份。
 */
export async function saveChanges(input: {
  changes: SettingChange[];
  expectedVersions: Record<string, number>;
  operatorId: string;
}): Promise<SaveGroupResult> {
  const normalized: {def: SettingDefinition; value: JsonValue}[] = [];
  for (const change of input.changes) {
    const def = SETTINGS_BY_KEY[change.key];
    if (!def) throw new SettingValidationError(change.key, '未登记的设置键。');
    normalized.push({def, value: normalizeSettingValue(def, change.value)});
  }
  if (normalized.length === 0) return {saved: [], versions: {}};

  const versions: Record<string, number> = {};
  await db.$transaction(async tx => {
    for (const {def, value} of normalized) {
      const current = await tx.operationSetting.findUnique({where: {key: def.key}});
      const currentVersion = current?.version ?? 0;
      const expected = input.expectedVersions[def.key];
      if (expected !== undefined && expected !== currentVersion) throw new SettingConflictError(def.key);
      const nextVersion = currentVersion + 1;
      const serialized = serializeSettingValue(value);
      await tx.operationSetting.upsert({
        where: {key: def.key},
        create: {key: def.key, group: def.group, value: serialized, version: nextVersion, updatedBy: input.operatorId},
        update: {value: serialized, version: nextVersion, updatedBy: input.operatorId},
      });
      await tx.settingRevision.create({
        data: {key: def.key, scope: 'GLOBAL', oldValue: current?.value ?? null, newValue: serialized, operatorId: input.operatorId},
      });
      versions[def.key] = nextVersion;
    }
  });
  for (const {def} of normalized) clearKeyEverywhere(def.key);
  return {saved: normalized.map(item => item.def.key), versions};
}

/** 按分组保存：先确认每一项都属于这个分组，再交给 saveChanges。 */
export async function saveGroup(input: {
  group: SettingGroup;
  changes: SettingChange[];
  expectedVersions: Record<string, number>;
  operatorId: string;
}): Promise<SaveGroupResult> {
  const allowed = new Set(definitionsOfGroup(input.group).map(def => def.key));
  for (const change of input.changes) {
    if (!allowed.has(change.key)) throw new SettingValidationError(change.key, '不属于当前分组。');
  }
  return saveChanges({changes: input.changes, expectedVersions: input.expectedVersions, operatorId: input.operatorId});
}

export async function readHistory(input: {group?: SettingGroup; key?: string; cursor?: string | null; take?: number}) {
  const take = Math.min(Math.max(input.take ?? 20, 1), 50);
  const keys = input.key ? [input.key] : input.group ? definitionsOfGroup(input.group).map(def => def.key) : undefined;
  const rows = await db.settingRevision.findMany({
    where: {...(keys ? {key: {in: keys}} : {})},
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
    take: take + 1,
    ...(input.cursor ? {cursor: {id: input.cursor}, skip: 1} : {}),
  });
  const page = rows.slice(0, take);
  return {
    items: page.map(row => ({
      id: row.id, key: row.key, scope: row.scope, oldValue: row.oldValue, newValue: row.newValue,
      operatorId: row.operatorId, createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > take ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function restoreRevision(input: {key: string; revisionId: string; operatorId: string}): Promise<SaveGroupResult> {
  const def = SETTINGS_BY_KEY[input.key];
  if (!def) throw new SettingValidationError(input.key, '未登记的设置键。');
  const revision = await db.settingRevision.findUnique({where: {id: input.revisionId}});
  if (!revision || revision.key !== input.key) throw new SettingValidationError(input.key, '找不到这条历史记录。');
  if (revision.scope !== 'GLOBAL') throw new SettingValidationError(input.key, '只能恢复公共设置的历史版本。');
  const value = normalizeSettingValue(def, JSON.parse(revision.newValue));
  const current = await db.operationSetting.findUnique({where: {key: input.key}});
  const nextVersion = (current?.version ?? 0) + 1;
  const serialized = serializeSettingValue(value);
  await db.$transaction(async tx => {
    await tx.operationSetting.upsert({
      where: {key: input.key},
      create: {key: input.key, group: def.group, value: serialized, version: nextVersion, updatedBy: input.operatorId},
      update: {value: serialized, version: nextVersion, updatedBy: input.operatorId},
    });
    await tx.settingRevision.create({
      data: {key: input.key, scope: 'GLOBAL', oldValue: current?.value ?? null, newValue: serialized, operatorId: input.operatorId},
    });
  });
  clearKeyEverywhere(input.key);
  return {saved: [input.key], versions: {[input.key]: nextVersion}};
}
