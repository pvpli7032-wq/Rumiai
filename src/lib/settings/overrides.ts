import {db} from '@/lib/db';
import {SETTINGS_BY_KEY, isUserOverridable} from './registry';
import {clearKeyEverywhere} from './cache';
import {normalizeSettingValue, serializeSettingValue, SettingValidationError} from './validation';
import type {JsonValue, SettingValue} from './types';

/**
 * 用户特例。只有额度、计费模式、折扣倍率与指定玩法次数允许覆盖；
 * 到期后读取时自动回落公共值，不做后台清理任务（V3 §7）。
 */

/** 用户详情页要能一次看到「继承公共值 / 有特例」两种状态。 */
export async function readUserQuota(userId: string, settings: SettingValue[]): Promise<SettingValue[]> {
  const rows = await db.userSettingOverride.findMany({where: {userId}});
  const now = new Date();
  const active = new Map(rows.filter(row => !row.expiresAt || row.expiresAt > now).map(row => [row.key, row]));
  return settings.map(setting => {
    const row = active.get(setting.key);
    if (!row) return setting;
    const def = SETTINGS_BY_KEY[setting.key];
    if (!def) return setting;
    let value: JsonValue;
    try { value = JSON.parse(row.value) as JsonValue; } catch { return setting; }
    return {...setting, value, source: 'USER' as const, version: row.version, expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null};
  });
}

export async function saveUserOverrides(input: {
  userId: string;
  changes: {key: string; value: JsonValue; expiresAt?: string | null}[];
  operatorId: string;
}): Promise<{saved: string[]}> {
  const normalized = input.changes.map(change => {
    const def = SETTINGS_BY_KEY[change.key];
    if (!def) throw new SettingValidationError(change.key, '未登记的设置键。');
    if (!isUserOverridable(change.key)) throw new SettingValidationError(change.key, '该项不允许按用户覆盖。');
    return {def, value: normalizeSettingValue(def, change.value), expiresAt: change.expiresAt ?? null};
  });
  await db.$transaction(async tx => {
    for (const item of normalized) {
      const serialized = serializeSettingValue(item.value);
      const current = await tx.userSettingOverride.findUnique({where: {userId_key: {userId: input.userId, key: item.def.key}}});
      await tx.userSettingOverride.upsert({
        where: {userId_key: {userId: input.userId, key: item.def.key}},
        create: {
          userId: input.userId, key: item.def.key, value: serialized,
          expiresAt: item.expiresAt ? new Date(item.expiresAt) : null, updatedBy: input.operatorId,
        },
        update: {
          value: serialized, version: {increment: 1},
          expiresAt: item.expiresAt ? new Date(item.expiresAt) : null, updatedBy: input.operatorId,
        },
      });
      await tx.settingRevision.create({
        data: {key: item.def.key, scope: 'USER', userId: input.userId, oldValue: current?.value ?? null, newValue: serialized, operatorId: input.operatorId},
      });
    }
  });
  for (const item of normalized) clearKeyEverywhere(item.def.key);
  return {saved: normalized.map(item => item.def.key)};
}

export async function deleteUserOverride(input: {userId: string; key: string; operatorId: string}): Promise<void> {
  const current = await db.userSettingOverride.findUnique({where: {userId_key: {userId: input.userId, key: input.key}}});
  if (!current) return;
  await db.$transaction(async tx => {
    await tx.userSettingOverride.delete({where: {userId_key: {userId: input.userId, key: input.key}}});
    await tx.settingRevision.create({
      data: {key: input.key, scope: 'USER', userId: input.userId, oldValue: current.value, newValue: 'null', operatorId: input.operatorId},
    });
  });
  clearKeyEverywhere(input.key);
}
