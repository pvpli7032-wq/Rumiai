'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Policy = { enabled: boolean; version: number };

export function CheckoutSettings({ token, canManage }: { token: string; canManage: boolean }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/admin/payments/checkout', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        if (!controller.signal.aborted) { setPolicy(data); setEnabled(data.enabled); }
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '无法读取充值设置。'); }
    })();
    return () => controller.abort();
  }, [token]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!policy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/payments/checkout', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, version: policy.version, reason }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setPolicy(data); setEnabled(data.enabled); setReason(''); setMessage('充值设置已保存，立即对新订单生效。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败。'); }
    finally { setBusy(false); }
  }

  return (
    <AdminPanel
      title="充值总开关"
      description="开启后，用户可通过已启用的正式商户购买有效人民币套餐。关闭仅停止新订单，已创建订单的通知和到账继续处理。"
      badge={<Badge variant={!policy ? 'neutral' : policy.enabled ? 'success' : 'danger'}>{policy ? policy.enabled ? '已开启' : '已关闭' : '读取中…'}</Badge>}
    >
      <div className="space-y-4">
        <form onSubmit={save} className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={enabled} disabled={!policy || !canManage || busy} onChange={event => setEnabled(event.target.checked)} />
            允许正式充值
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-64 flex-1 space-y-1.5">
              <span className="text-sm font-medium">充值开关操作理由</span>
              <Input required maxLength={300} value={reason} disabled={!policy || !canManage || busy} onChange={event => setReason(event.target.value)} />
            </label>
            <Button type="submit" loading={busy} disabled={!policy || !canManage || busy}>保存充值开关</Button>
          </div>
        </form>
        {message && <AdminNotice tone="success" title={message} />}
      </div>
    </AdminPanel>
  );
}
