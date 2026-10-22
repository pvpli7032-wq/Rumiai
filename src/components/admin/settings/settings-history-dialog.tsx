'use client';

import {History} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {API} from '@/lib/api-paths';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {SETTING_GROUPS, SETTINGS_BY_KEY} from '@/lib/settings/registry';
import {formatStoredValue, type SettingRevision} from './history';

/**
 * 修改历史：每项设置最近改了什么、谁改的；可以恢复某个历史版本（生成新版本，不改旧记录）。
 *
 * 恢复只影响这一项，不会顺带保存页面上的草稿；恢复成功后页面重新读取本分类。
 */
export interface SettingsHistoryDialogProps {
  open: boolean;
  token: string;
  group: string;
  canWrite: boolean;
  definitions: {key: string; label: string}[];
  onClose: () => void;
  onRestored: () => void;
}

export function SettingsHistoryDialog({open, token, group, canWrite, definitions, onClose, onRestored}: SettingsHistoryDialogProps) {
  const [items, setItems] = useState<SettingRevision[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [filterKey, setFilterKey] = useState('');
  const label = SETTING_GROUPS.find(item => item.id === group)?.label ?? '设置';

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setError('');
    try {
      const url = API.admin.settingsHistory(
        new URLSearchParams({group, ...(filterKey ? {key: filterKey} : {}), ...(cursor ? {cursor} : {})}).toString(),
      );
      const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store'});
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || '修改历史读取失败，请稍后重试。');
      setItems(current => (cursor ? [...current, ...payload.items] : payload.items));
      setNextCursor(payload.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '修改历史读取失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [token, group, filterKey]);

  useEffect(() => {
    if (!open) return;
    setItems([]);
    setNextCursor(null);
    setNotice('');
    void load(null);
  }, [open, load]);

  async function restore(revision: SettingRevision) {
    if (!canWrite) return;
    setBusyId(revision.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(API.admin.settingsRestore, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({key: revision.key, revisionId: revision.id}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || '恢复失败，请稍后重试。');
      setNotice('已恢复，并生成一个新版本；旧记录保持原样。');
      onRestored();
      await load(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复失败，请稍后重试。');
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${label}的修改历史`}
      description="按时间倒序显示；恢复历史值会生成新版本，不会删除或改写旧记录。"
      size="xl"
      footer={<Button variant="outline" onClick={onClose}>关闭</Button>}
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">只看某一项</span>
            <select
              value={filterKey}
              onChange={event => setFilterKey(event.target.value)}
              className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部（本分类）</option>
              {definitions.map(definition => (
                <option key={definition.key} value={definition.key}>{definition.label}</option>
              ))}
            </select>
          </label>
        </div>

        {notice && <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm">{notice}</p>}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {items.length === 0 && !loading && !error && (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无修改记录。</p>
        )}

        {items.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map(revision => {
              const definition = SETTINGS_BY_KEY[revision.key];
              return (
                <li key={revision.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                      {definition?.label ?? revision.key}
                      <span className="text-xs font-normal text-muted-foreground">{revision.scope === 'USER' ? '用户特例' : '公共值'}</span>
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {formatStoredValue(revision.oldValue)} → {formatStoredValue(revision.newValue)}
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString('zh-CN')}</p>
                  </div>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busyId === revision.id}
                      onClick={() => { void restore(revision); }}
                      leadingIcon={<History aria-hidden className="h-3.5 w-3.5" />}
                    >
                      恢复此版本
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" loading={loading} onClick={() => { void load(nextCursor); }}>
              加载更多
            </Button>
          </div>
        )}
        {loading && items.length > 0 && <p className="text-center text-xs text-muted-foreground">加载中…</p>}
      </div>
    </Dialog>
  );
}
