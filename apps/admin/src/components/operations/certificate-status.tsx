'use client';

import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAdminAccess } from '../use-admin-access';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';

type Status = { target: { hostname: string; port: number } | null; lastCheck: { status: string; verified: boolean; validFrom: string | null; validUntil: string | null; checkedAt: string; errorCode: string | null; fingerprint256: string | null; remainingDays: number | null } | null };
const labels: Record<string, string> = { VALID: '有效', EXPIRING: '30 天内到期', EXPIRED: '已过期', INVALID: '校验不通过', UNAVAILABLE: '无法连接' };
const tone = (status?: string) => status === 'VALID' ? 'success' : status === 'EXPIRING' ? 'warning' : 'danger';
const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '未知';

export function CertificateStatus({ sessionActive }: { sessionActive: boolean }) {
  const { permissions } = useAdminAccess();
  const canCheck = permissions.includes('operations.certificates.check');
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setStatus(null); setError('');
    void fetch('/api/admin/operations/certificate', {credentials: 'include', cache: 'no-store', signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error ?? '证书状态读取失败。'); if (!controller.signal.aborted) setStatus(data); }).catch(value => { if (!controller.signal.aborted) setError(value.message); });
    return () => controller.abort();
  }, [sessionActive]);

  async function check() {
    if (!canCheck || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/operations/certificate', { method: 'POST', credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? '证书检查失败。');
      setStatus(data);
    } catch (value) { setError((value as Error).message); } finally { setBusy(false); }
  }

  const observation = status?.lastCheck;

  return (
    <AdminPanel
      title="HTTPS 证书"
      description="显示该次 TLS 检查的结果，不执行签发或续签，也不代表服务器自动续签已验收。"
      actions={canCheck ? <Button variant="outline" size="sm" leadingIcon={<ShieldCheck className="h-4 w-4" />} loading={busy} disabled={busy || !status?.target} onClick={() => void check()}>检查证书</Button> : undefined}
    >
      <div className="space-y-4">
        {error && <AdminNotice tone="error" title={error} />}
        {!status && !error && <AdminNotice tone="loading" title="正在读取证书状态…" />}
        {status && !status.target && <AdminNotice tone="info" title="尚未配置 HTTPS 站点地址" description="请由运维人员在服务器设置站点域名。" />}
        {status?.target && (
          <div className="space-y-4">
            <p className="break-all text-sm text-muted-foreground">检查目标：{status.target.hostname}:{status.target.port}</p>
            {observation ? (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">上次检查状态</span>
                  <Badge variant={tone(observation.status)}>{labels[observation.status] ?? observation.status}</Badge>
                  {observation.remainingDays !== null && <Badge variant="outline">距到期 {observation.remainingDays} 天</Badge>}
                </div>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border p-3">
                    <dt className="text-xs text-muted-foreground">生效时间</dt>
                    <dd className="mt-1 text-sm">{time(observation.validFrom)}</dd>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <dt className="text-xs text-muted-foreground">到期时间</dt>
                    <dd className="mt-1 text-sm">{time(observation.validUntil)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">最近检查：{time(observation.checkedAt)}</p>
                {observation.errorCode && <p className="break-all text-xs text-muted-foreground">原因码：{observation.errorCode}</p>}
                {observation.fingerprint256 && (
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer text-xs">SHA-256 证书指纹</summary>
                    <p className="mt-2 break-all text-xs">{observation.fingerprint256}</p>
                  </details>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">此站点尚无证书检查记录。</p>
            )}
          </div>
        )}
      </div>
    </AdminPanel>
  );
}
