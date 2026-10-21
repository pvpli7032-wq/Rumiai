'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {API} from '@/lib/api-paths';
import {definitionsOfGroup} from '@/lib/settings/registry';
import type {JsonValue, SettingDefinition, SettingGroup, SettingValue} from '@/lib/settings/types';
import {sameSettingValue, validateSettingValue} from './format';

/**
 * 一个设置分类的读取、草稿与保存。
 *
 * 字段定义来自 `@/lib/settings/registry`（纯数据，客户端可用），接口只返回值、
 * 来源和版本：一次读取一个分类，保存时按分类一次提交并带上版本号防并发覆盖。
 */

interface SettingsPayload {
  values?: unknown;
  items?: unknown;
  settings?: unknown;
}

function readValues(payload: unknown): SettingValue[] {
  if (Array.isArray(payload)) return payload as SettingValue[];
  if (payload && typeof payload === 'object') {
    const record = payload as SettingsPayload;
    for (const candidate of [record.values, record.items, record.settings]) {
      if (Array.isArray(candidate)) return candidate as SettingValue[];
    }
  }
  return [];
}

function isSettingValue(value: unknown): value is SettingValue {
  return Boolean(value) && typeof value === 'object' && typeof (value as SettingValue).key === 'string';
}

function draftOf(definitions: SettingDefinition[], values: Record<string, SettingValue>): Record<string, JsonValue> {
  return Object.fromEntries(definitions.map(definition => [definition.key, values[definition.key]?.value ?? definition.default]));
}

export interface SettingsGroupController {
  definitions: SettingDefinition[];
  values: Record<string, SettingValue>;
  draft: Record<string, JsonValue>;
  dirtyKeys: string[];
  fieldErrors: Record<string, string>;
  loading: boolean;
  loadError: string;
  saving: boolean;
  saveError: string;
  savedAt: number | null;
  setValue: (key: string, value: JsonValue) => void;
  discard: () => void;
  reload: () => void;
  save: () => Promise<boolean>;
}

export function useSettingsGroup(token: string | undefined, group: SettingGroup, enabled: boolean): SettingsGroupController {
  const definitions = useMemo(() => definitionsOfGroup(group), [group]);
  const [values, setValues] = useState<Record<string, SettingValue>>({});
  const [draft, setDraft] = useState<Record<string, JsonValue>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!token || !enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const response = await fetch(`${API.admin.settings}?group=${encodeURIComponent(group)}`, {
          headers: {Authorization: `Bearer ${token}`},
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error((payload as {error?: string} | null)?.error || '设置读取失败，请稍后重试。');
        }
        const items = readValues(payload).filter(isSettingValue);
        // 空分类也是合法结果：界面显示「这个分类下还没有可配置的项目」，不能当成读取失败。
        if (!items.length && definitions.length > 0) throw new Error('没有读取到该分类的设置值，请稍后重试。');
        if (controller.signal.aborted) return;
        const next = Object.fromEntries(items.map(item => [item.key, item]));
        setValues(next);
        setDraft(draftOf(definitions, next));
        setFieldErrors({});
        setSaveError('');
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : '设置读取失败，请稍后重试。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, enabled, group, reloadToken, definitions]);

  const dirtyKeys = useMemo(
    () => definitions.filter(definition => {
      const saved = values[definition.key]?.value ?? definition.default;
      const current = definition.key in draft ? draft[definition.key] : definition.default;
      return !sameSettingValue(saved, current);
    }).map(definition => definition.key),
    [definitions, values, draft],
  );

  const setValue = useCallback((key: string, value: JsonValue) => {
    setDraft(current => ({...current, [key]: value}));
    setSavedAt(null);
  }, []);

  const discard = useCallback(() => {
    setDraft(draftOf(definitions, values));
    setFieldErrors({});
    setSaveError('');
  }, [definitions, values]);

  const reload = useCallback(() => setReloadToken(value => value + 1), []);

  const save = useCallback(async () => {
    if (!token || !dirtyKeys.length || saving) return false;
    // 先在本地按服务端同一套规则查一遍，字段级错误不必等一次往返。
    const invalid: Record<string, string> = {};
    for (const key of dirtyKeys) {
      const definition = definitions.find(item => item.key === key);
      if (!definition) continue;
      const message = validateSettingValue(definition, draft[key] ?? null);
      if (message) invalid[key] = message;
    }
    if (Object.keys(invalid).length) {
      setFieldErrors(invalid);
      setSaveError('有字段不符合要求，请先修正标出的项。');
      return false;
    }
    setFieldErrors({});
    setSaving(true);
    setSaveError('');
    try {
      const changes = dirtyKeys.map(key => ({key, value: draft[key] ?? null}));
      const expectedVersions = Object.fromEntries(dirtyKeys.map(key => [key, values[key]?.version ?? 0]));
      const response = await fetch(API.admin.settings, {
        method: 'PATCH',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({group, changes, expectedVersions}),
      });
      const payload = await response.json().catch(() => null) as {error?: string; key?: string; versions?: Record<string, number>} | null;
      if (!response.ok) {
        if (response.status === 409) {
          setSaveError('设置已被其他管理员修改，请刷新后重试。');
        } else {
          setSaveError(payload?.error || '保存失败，请稍后重试。');
        }
        if (payload?.key) setFieldErrors(current => ({...current, [payload.key as string]: payload.error || '保存失败。'}));
        return false;
      }
      const versions = payload?.versions ?? {};
      setValues(current => {
        const next = {...current};
        for (const key of dirtyKeys) {
          next[key] = {
            key,
            value: draft[key] ?? null,
            source: 'GLOBAL',
            version: versions[key] ?? (current[key]?.version ?? 0) + 1,
            expiresAt: null,
          };
        }
        return next;
      });
      setFieldErrors({});
      setSavedAt(Date.now());
      return true;
    } catch {
      setSaveError('保存失败，请检查网络后重试。');
      return false;
    } finally {
      setSaving(false);
    }
  }, [token, dirtyKeys, saving, draft, values, group, definitions]);

  return {
    definitions, values, draft, dirtyKeys, fieldErrors,
    loading, loadError, saving, saveError, savedAt,
    setValue, discard, reload, save,
  };
}
