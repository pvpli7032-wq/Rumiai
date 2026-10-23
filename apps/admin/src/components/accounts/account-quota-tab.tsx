'use client';

import {useCallback, useEffect, useState} from 'react';
import {RotateCcw, SlidersHorizontal} from 'lucide-react';
import type {AdminPermission} from '@rumiai/contracts/admin/permissions';
import type {JsonValue, SettingDefinition, SettingValue} from '@rumiai/contracts/settings/types';
import {API} from '@rumiai/contracts/api-paths';
import {toDateTimeLocalInput} from '@rumiai/contracts/format/date-time';
import {apiFetch} from '@admin/lib/api-client';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';
import {rangeHint, validateSettingValue} from '../settings/format';
import {AdminNotice} from '../admin-page';

/**
 * 用户详情「额度特例」标签（V3 §15：额度特例放单独标签，默认「继承公共值」；
 * 只改一个用户时不用跳到全局特例列表）。
 *
 * 只渲染后端下发的 definitions —— 那份列表来自 registry 的 userOverridable，
 * 正好是 V3 允许覆盖的四类（额度、计费模式、折扣倍率、指定玩法次数）。前端不另抄
 * 一份白名单，否则两边迟早会不一致。
 */

interface QuotaPayload {
  userId: string;
  values: SettingValue[];
  definitions: SettingDefinition[];
}

const SOURCE_TEXT = {USER: '用户特例', GLOBAL: '继承公共值', DEFAULT: '继承公共值'} as const;

/** 数值写成人话；空值代表「不设上限」，不能用 0 冒充。 */
function quotaText(definition: SettingDefinition, value: JsonValue | undefined): string {
  if (value === null || value === undefined) return '不设上限';
  return definition.unit ? `${value} ${definition.unit}` : String(value);
}

function formatExpiry(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '长期有效';
}

export function AccountQuotaTab({userId, sessionActive, permissions}: {userId: string; sessionActive: boolean; permissions: AdminPermission[]}) {
  const allowed = permissions.includes('accounts.settings.manage');
  const [payload, setPayload] = useState<QuotaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [draftExpiry, setDraftExpiry] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!sessionActive || !allowed) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const data = await apiFetch<QuotaPayload>(API.admin.accountSettings(userId), {credentials: 'same-origin', signal: controller.signal, cache: 'no-store'});
        if (!controller.signal.aborted) setPayload(data);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoadError(cause instanceof Error ? cause.message : '用户特例读取失败，请稍后重试。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [userId, sessionActive, allowed, reloadToken]);

  // 保存/清除后只重新读这个标签的数据，不整页重载。
  const refresh = useCallback(() => setReloadToken(value => value + 1), []);

  if (!allowed) {
    return (
      <AdminNotice
        tone="denied"
        title="没有用户额度设置权限"
        description="查看或修改单个用户的额度特例需要「用户额度设置」权限（accounts.settings.manage）。可以联系站点所有者或计费管理员授予。"
      />
    );
  }
  if (loading && !payload) return <AdminNotice tone="loading" title="正在读取用户特例…" />;
  if (loadError) {
    return <AdminNotice tone="error" title="用户特例读取失败" description={loadError} action={<Button variant="outline" size="sm" onClick={refresh}>重试</Button>} />;
  }
  if (!payload) return null;

  const valueOf = (key: string) => payload.values.find(item => item.key === key);

  function startEdit(definition: SettingDefinition, current: SettingValue | undefined) {
    setEditing(definition.key);
    setDraftValue(String(current?.value ?? definition.default ?? ''));
    setDraftExpiry(toDateTimeLocalInput(current?.expiresAt));
    setRowErrors(list => ({...list, [definition.key]: ''}));
  }

  async function save(definition: SettingDefinition) {
    if (!sessionActive || busy) return;
    const raw = draftValue.trim();
    const value: JsonValue = raw === '' ? null : Number(raw);
    const invalid = validateSettingValue(definition, value);
    if (invalid) { setRowErrors(list => ({...list, [definition.key]: invalid})); return; }
    const expiresAt = draftExpiry ? new Date(draftExpiry).toISOString() : null;
    setBusy(definition.key);
    setRowErrors(list => ({...list, [definition.key]: ''}));
    try {
      await apiFetch(API.admin.accountSettings(userId), {
        method: 'PUT',
        credentials: 'same-origin',
        body: {changes: [{key: definition.key, value, expiresAt}]},
      });
      setEditing(null);
      setNotice(`已保存「${definition.label}」的用户特例。`);
      refresh();
    } catch (cause) {
      setRowErrors(list => ({...list, [definition.key]: cause instanceof Error ? cause.message : '保存失败，请稍后重试。'}));
    } finally {
      setBusy(null);
    }
  }

  async function clear(definition: SettingDefinition) {
    if (!sessionActive || busy) return;
    setBusy(definition.key);
    setRowErrors(list => ({...list, [definition.key]: ''}));
    try {
      await apiFetch(API.admin.accountSetting(userId, definition.key), {method: 'DELETE', credentials: 'same-origin'});
      setNotice(`已清除「${definition.label}」的用户特例，回到公共值。`);
      refresh();
    } catch (cause) {
      setRowErrors(list => ({...list, [definition.key]: cause instanceof Error ? cause.message : '清除失败，请稍后重试。'}));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-muted-foreground">
        这里只列 V3 允许按用户覆盖的额度、计费模式、折扣倍率与玩法次数。没设特例时按「继承公共值」生效，括号里是继承来的实际数值；设了特例只影响这一个用户。
      </p>
      {notice && <p role="status" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">{notice}</p>}

      <ul className="space-y-2">
        {payload.definitions.map(definition => {
          const current = valueOf(definition.key);
          const source = current?.source ?? 'DEFAULT';
          const overridden = source === 'USER';
          const editingThis = editing === definition.key;
          const error = rowErrors[definition.key];
          return (
            <li key={definition.key} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span>{definition.label}</span>
                    <Badge variant={overridden ? 'brand' : 'outline'}>{SOURCE_TEXT[source]}</Badge>
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">当前生效值：</span>{' '}
                    <span className="font-medium">{quotaText(definition, current?.value)}</span>
                    {source === 'DEFAULT' && <span className="ml-1 text-xs text-muted-foreground">（登记默认值，后台尚未单独保存）</span>}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {overridden ? `到期时间：${formatExpiry(current?.expiresAt)}` : `公共值：${quotaText(definition, current?.value)}`}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{definition.description}</p>
                  {definition.type !== 'number' && <p className="mt-1 text-xs text-amber-600">该项不是数值，暂只支持在全局设置里修改。</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" leadingIcon={<SlidersHorizontal className="h-3.5 w-3.5" />} disabled={busy === definition.key || definition.type !== 'number'} onClick={() => (editingThis ? setEditing(null) : startEdit(definition, current))}>
                    {overridden ? '修改特例' : '设特例'}
                  </Button>
                  {overridden && (
                    <Button variant="ghost" size="sm" leadingIcon={<RotateCcw className="h-3.5 w-3.5" />} disabled={busy === definition.key} onClick={() => void clear(definition)}>
                      清除特例
                    </Button>
                  )}
                </div>
              </div>

              {editingThis && (
                <div className="mt-3 grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">{definition.label}{definition.unit ? `（${definition.unit}）` : ''}</span>
                    <Input type="number" inputMode="numeric" aria-label={`${definition.label}特例值`} value={draftValue} onChange={event => setDraftValue(event.target.value)} />
                    <span className="block text-xs text-muted-foreground">{rangeHint(definition)}</span>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">到期时间（可空）</span>
                    <Input type="datetime-local" aria-label={`${definition.label}特例到期时间`} value={draftExpiry} onChange={event => setDraftExpiry(event.target.value)} />
                    <span className="block text-xs text-muted-foreground">留空表示长期有效；到期后自动回到公共值。</span>
                  </label>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <Button size="sm" loading={busy === definition.key} disabled={busy === definition.key} onClick={() => void save(definition)}>保存特例</Button>
                    <Button size="sm" variant="ghost" disabled={busy === definition.key} onClick={() => setEditing(null)}>取消</Button>
                  </div>
                </div>
              )}
              {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
