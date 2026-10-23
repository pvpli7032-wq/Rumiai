'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAdminAccess } from '../use-admin-access';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Policy = { enabled: boolean; message: string; retryAfterSeconds: number; version: number };

export function MaintenanceSettings({ sessionActive }: { sessionActive: boolean }) {
  const { permissions } = useAdminAccess();
  const canManage = permissions.includes('operations.maintenance.manage');
  const [policy, setPolicy] = useState<Policy | null>(null), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setPolicy(null); setError('');
    void fetch('/api/admin/operations/maintenance', {credentials: 'include', cache: 'no-store', signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error ?? '维护设置读取失败。'); if (!controller.signal.aborted) setPolicy(data); }).catch(value => { if (!controller.signal.aborted) setError(value.message); });
    return () => controller.abort();
  }, [sessionActive, revision]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!policy || !canManage || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/operations/maintenance', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...policy, reason }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? '维护设置保存失败。');
      setPolicy(data); setReason('');
      setMessage(data.enabled ? '维护模式已开启，新业务提交暂停。' : '维护模式已关闭，业务提交恢复。');
    } catch (value) { setError((value as Error).message); } finally { setBusy(false); }
  }

  return (
    <AdminPanel
      title="业务只读维护"
      description="开启后暂停注册、聊天、发帖、充值和上传等新提交。浏览与查询、登录/退出、管理接口及支付回调继续处理；已经开始的请求继续完成。"
      badge={policy ? <Badge variant={policy.enabled ? 'warning' : 'success'}>{policy.enabled ? '维护中' : '运行中'}</Badge> : undefined}
      actions={<Button variant="outline" size="sm" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新维护设置</Button>}
    >
      <div className="space-y-4">
        {error && <AdminNotice tone="error" title={error} />}
        {message && <AdminNotice tone="success" title={message} />}
        {!policy && !error && <AdminNotice tone="loading" title="正在读取维护设置…" />}
        {policy && (
          <form className="space-y-4" onSubmit={save}>
            <fieldset disabled={!canManage || busy} className="space-y-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={policy.enabled} onChange={event => setPolicy({ ...policy, enabled: event.target.checked })} />
                开启业务只读维护
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">维护提示</span>
                  <Textarea required rows={3} maxLength={300} value={policy.message} onChange={event => setPolicy({ ...policy, message: event.target.value })} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">建议重试秒数</span>
                  <Input type="number" required min={60} max={86400} value={policy.retryAfterSeconds} onChange={event => setPolicy({ ...policy, retryAfterSeconds: Number(event.target.value) })} />
                </label>
              </div>
              {canManage && (
                <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <label className="block min-w-64 flex-1 space-y-1.5">
                    <span className="text-sm font-medium">维护变更理由</span>
                    <Input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
                  </label>
                  <Button type="submit" loading={busy} disabled={busy || !reason.trim()}>保存维护设置</Button>
                </div>
              )}
            </fieldset>
            {!canManage && <p className="text-sm text-muted-foreground">当前账号只有运维查看权限。</p>}
          </form>
        )}
      </div>
    </AdminPanel>
  );
}
