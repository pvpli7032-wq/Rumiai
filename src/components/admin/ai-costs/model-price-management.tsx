'use client';

import { Tag } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAdminAccess } from '@/components/admin/use-admin-access';
import { AdminNotice, AdminPanel } from '@/components/admin/admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

type Price = { id: string; currency: string; inputPricePerMillion: string; outputPricePerMillion: string; effectiveAt: string; source: string; createdAt: string };
type Model = { id: string; key: string; displayName: string; modelCode: string; providerName: string; isActive: boolean; prices: Price[] };
type Result = { generatedAt: string; models: Model[] };

function localDateTime() {
  const date = new Date(Date.now() + 60_000); date.setSeconds(0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function ModelPriceManagement() {
  const { token, permissions, loading } = useAdminAccess();
  const [data, setData] = useState<Result | null>(null); const [modelId, setModelId] = useState(''); const [currency, setCurrency] = useState('USD'); const [input, setInput] = useState(''); const [output, setOutput] = useState(''); const [effectiveAt, setEffectiveAt] = useState(localDateTime); const [source, setSource] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const canManage = permissions.includes('ai.costs.manage');
  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch('/api/admin/ai/prices', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    setData(result); setModelId(current => current || result.models[0]?.id || '');
  }, [token]);
  useEffect(() => { let active = true; if (token) void load().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '价格数据加载失败。'); }); return () => { active = false; }; }, [token, load]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!token) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/ai/prices', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId, currency, inputPricePerMillion: input, outputPricePerMillion: output, effectiveAt: new Date(effectiveAt).toISOString(), source, reason }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setInput(''); setOutput(''); setSource(''); setReason('');
      setNotice('价格版本已追加并写入审计；不会改变历史记录或启用聊天扣币。');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '价格版本保存失败。'); } finally { setBusy(false); }
  }

  return (
    <AdminPanel
      aria-label="模型价格历史"
      title="模型价格历史"
      description="按百万 Token 记录输入/输出单价、币种、来源和生效时间。保存为不可覆盖的历史版本，用于估算后续调用成本；不设置用户售价，也不会扣除金币。"
      badge={data ? <Badge variant="outline">{data.models.length} 个模型</Badge> : undefined}
    >
      <div className="space-y-5">
        {error && <AdminNotice tone="error" title={error} />}
        {notice && <AdminNotice tone="success" title={notice} />}
        {!data && <AdminNotice tone="loading" title="正在加载模型价格…" />}
        {data && (
          <>
            {canManage && (
              <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">模型</span>
                    <Select aria-label="模型" required value={modelId} onChange={event => setModelId(event.target.value)}>
                      <option value="">选择模型</option>
                      {data.models.map(model => <option key={model.id} value={model.id}>{model.displayName} · {model.providerName} · {model.key}{model.isActive ? '' : '（停用）'}</option>)}
                    </Select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">币种</span>
                    <Input required maxLength={3} pattern="[A-Z]{3}" className="uppercase" value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">输入单价 / 百万 Token</span>
                    <Input required inputMode="decimal" pattern="\d{1,12}(\.\d{1,6})?" value={input} onChange={event => setInput(event.target.value)} placeholder="例如 0.000000" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">输出单价 / 百万 Token</span>
                    <Input required inputMode="decimal" pattern="\d{1,12}(\.\d{1,6})?" value={output} onChange={event => setOutput(event.target.value)} placeholder="例如 0.000000" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">生效时间（按本机时区输入）</span>
                    <Input required type="datetime-local" value={effectiveAt} onChange={event => setEffectiveAt(event.target.value)} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">价格来源</span>
                    <Input required maxLength={500} value={source} onChange={event => setSource(event.target.value)} placeholder="供应商公开价格页或合同版本" />
                  </label>
                  <label className="block space-y-1.5 sm:col-span-2">
                    <span className="text-sm font-medium">操作理由</span>
                    <Input required maxLength={300} value={reason} onChange={event => setReason(event.target.value)} />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" loading={busy} disabled={loading || !modelId}>{busy ? '保存中…' : '追加价格版本'}</Button>
                  <span className="text-xs text-muted-foreground">现有版本不能编辑或删除；新版本生效时间必须晚于已有版本。</span>
                </div>
              </form>
            )}
            {!data.models.length && (
              <AdminNotice tone="info" title="尚未建立数据库模型路由。" description="先在「模型与路由」登记模型，再回来登记价格。" />
            )}
            <div className="space-y-3">
              {data.models.map(model => (
                <article key={model.id} className="min-w-0 space-y-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words font-medium">{model.displayName}</h3>
                    <span className="break-all text-sm text-muted-foreground">{model.providerName} · {model.modelCode}</span>
                    <Badge variant="outline">{model.prices.length} 个版本</Badge>
                  </div>
                  {model.prices.length ? (
                    <div className="space-y-2">
                      {model.prices.map(price => (
                        <div key={price.id} className="grid gap-1 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-[1fr_auto]">
                          <div>
                            <p className="tabular-nums">{price.currency} · 输入 {price.inputPricePerMillion} / 输出 {price.outputPricePerMillion} / 百万 Token</p>
                            <p className="break-all text-xs text-muted-foreground">来源：{price.source}</p>
                          </div>
                          <time className="text-xs text-muted-foreground sm:text-right">生效 {new Date(price.effectiveAt).toLocaleString('zh-CN', { timeZone: 'UTC' })} UTC</time>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Tag aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                      尚无价格版本。当前 AI 调用成本仍按已配置的兼容环境单价估算或标记未知。
                    </p>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </AdminPanel>
  );
}
