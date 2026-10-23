'use client';

import { useEffect, useState } from 'react';
import { useAdminAccess } from '../use-admin-access';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Scope = { restricted: boolean; version: number; modelKeys: string[]; options: { key: string; displayName: string; available: boolean }[] };

export function CharacterModelAccess({ characterId, deleted = false }: { characterId: string; deleted?: boolean }) {
  const { sessionActive, permissions } = useAdminAccess();
  const canEdit = permissions.includes('characters.write') && !deleted;
  const [scope, setScope] = useState<Scope | null>(null), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const endpoint = `/api/admin/characters/${encodeURIComponent(characterId)}/models`;
  useEffect(() => {
    setScope(null); setError(''); setMessage(''); setReason('');
    if (!sessionActive) return;
    const controller = new AbortController();
    void fetch(endpoint, {credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error ?? '模型范围读取失败。'); if (!controller.signal.aborted) setScope(data); })
      .catch(value => { if (!controller.signal.aborted) setError(value.message); });
    return () => controller.abort();
  }, [endpoint, sessionActive]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!scope || !canEdit || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restricted: scope.restricted, modelKeys: scope.modelKeys, version: scope.version, reason }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? '模型范围保存失败。');
      setScope({ ...scope, ...data }); setReason('');
      setMessage('角色模型范围已生效，用户选择和备用路由均受此范围约束。');
    } catch (value) { setError((value as Error).message); } finally { setBusy(false); }
  }

  return (
    <AdminPanel
      title="可选 AI 模型"
      description="使用全站目录或指定此角色的模型范围；备用降级也只能使用范围内模型。此设置立即生效，内容发布状态单独管理。"
      badge={scope ? <Badge variant={scope.restricted ? 'brand' : 'outline'}>{scope.restricted ? '限定范围' : '全站目录'}</Badge> : undefined}
    >
      <div className="space-y-4">
        {error && <AdminNotice tone="error" title={error} />}
        {message && <AdminNotice tone="success" title={message} />}
        {!scope && !error && <AdminNotice tone="loading" title="正在读取模型范围…" />}
        {scope && (
          <form onSubmit={save} className="space-y-4">
            <fieldset disabled={busy || !canEdit} className="space-y-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={scope.restricted} onChange={event => setScope({ ...scope, restricted: event.target.checked })} />
                仅允许指定模型
              </label>
              {!scope.options.length && <p className="text-sm text-muted-foreground">尚未配置模型目录，请先在 AI 模型与路由中登记模型。</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {scope.options.map(option => (
                  <label key={option.key} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-border accent-brand"
                      disabled={!scope.restricted}
                      checked={scope.modelKeys.includes(option.key)}
                      onChange={event => setScope({ ...scope, modelKeys: event.target.checked ? [...scope.modelKeys, option.key] : scope.modelKeys.filter(key => key !== option.key) })}
                    />
                    <span className="min-w-0 break-all">{option.displayName} <span className="text-muted-foreground">({option.key}){!option.available ? ' · 当前停用' : ''}</span></span>
                  </label>
                ))}
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <label className="block min-w-64 flex-1 space-y-1.5">
                    <span className="text-sm font-medium">模型范围操作理由</span>
                    <Input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
                  </label>
                  <Button type="submit" loading={busy} disabled={busy || !reason.trim() || (scope.restricted && !scope.modelKeys.length)}>保存模型范围</Button>
                </div>
              )}
            </fieldset>
            {!canEdit && <p className="text-sm text-muted-foreground">当前仅可查看模型范围。</p>}
          </form>
        )}
      </div>
    </AdminPanel>
  );
}
