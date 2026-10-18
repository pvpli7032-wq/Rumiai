'use client';

import {useEffect, useState, type FormEvent} from 'react';

type Policy = {enabled: boolean; version: number};

export function CheckoutSettings({token, canManage}: {token: string; canManage: boolean}) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/admin/payments/checkout', {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal: controller.signal});
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        if (!controller.signal.aborted) {setPolicy(data); setEnabled(data.enabled);}
      } catch (error) {if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '无法读取充值设置。');}
    })();
    return () => controller.abort();
  }, [token]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!policy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/payments/checkout', {method: 'PUT', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({enabled, version: policy.version, reason})});
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setPolicy(data); setEnabled(data.enabled); setReason(''); setMessage('充值设置已保存，立即对新订单生效。');
    } catch (error) {setMessage(error instanceof Error ? error.message : '保存失败。');}
    finally {setBusy(false);}
  }

  return <section className="space-y-3 rounded-xl border p-4" aria-label="充值总开关">
    <h2 className="font-semibold">充值总开关</h2>
    <p className="text-sm text-muted-foreground">开启后，用户可通过已启用的正式商户购买有效人民币套餐。关闭仅停止新订单，已创建订单的通知和到账继续处理。</p>
    <p className="text-sm">当前设置：{policy ? policy.enabled ? '已开启' : '已关闭' : '读取中…'}</p>
    <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={enabled} disabled={!policy || !canManage || busy} onChange={event => setEnabled(event.target.checked)} />允许正式充值</label>
      <label className="min-w-0 flex-1 text-sm">充值开关操作理由<input required maxLength={300} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" value={reason} disabled={!policy || !canManage || busy} onChange={event => setReason(event.target.value)} /></label>
      <button className="min-h-11 rounded-lg border px-4" disabled={!policy || !canManage || busy}>{busy ? '保存中…' : '保存充值开关'}</button>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
