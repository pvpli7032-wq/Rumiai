'use client';

import {ChevronDown, ChevronRight, ShieldOff} from 'lucide-react';
import {useId, useState, type FormEvent} from 'react';
import {AdminNotice, AdminPanel} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {formatAmount, formatDateTime, type BudgetRow} from './types';

/**
 * 预算与熔断（高级设置，默认折叠）。
 *
 * 预算按币种分别配置，达到阈值只提示或熔断新请求；未知成本不按 0 计算。
 * 这里保留原有的编辑能力，但收进折叠区，日常看价格时不会挡路。
 */
export interface BudgetDraft {
  currency: string;
  siteLimit: string;
  userLimit: string;
  isActive: boolean;
  version: number;
  reason: string;
  isExisting: boolean;
}

export interface BudgetPanelProps {
  rows: BudgetRow[];
  source: string;
  status: string;
  circuitBreaker: string;
  circuitBreakerVersion: number;
  canManage: boolean;
  busy: boolean;
  onSaveBudget: (draft: BudgetDraft) => void;
  onSaveBreaker: (enabled: boolean, reason: string, version: number) => void;
}

function emptyDraft(row?: BudgetRow): BudgetDraft {
  return {
    currency: row?.currency ?? 'USD',
    siteLimit: row?.siteLimit === null || row?.siteLimit === undefined ? '' : String(row.siteLimit),
    userLimit: row?.userLimit === null || row?.userLimit === undefined ? '' : String(row.userLimit),
    isActive: row?.isActive ?? true,
    version: row?.version ?? 0,
    reason: '',
    isExisting: Boolean(row),
  };
}

export function BudgetPanel({rows, source, status, circuitBreaker, circuitBreakerVersion, canManage, busy, onSaveBudget, onSaveBreaker}: BudgetPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BudgetDraft | null>(null);
  const [breakerOpen, setBreakerOpen] = useState(false);
  const [breakerEnabled, setBreakerEnabled] = useState(circuitBreaker === 'enabled');
  const [breakerReason, setBreakerReason] = useState('');
  const [formError, setFormError] = useState('');
  const panelId = useId();

  const breakerLabel = circuitBreaker === 'enabled' ? '已启用' : circuitBreaker === 'invalid' ? '配置无效' : '关闭';

  function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.reason.trim()) { setFormError('请填写操作理由，会写入管理审计。'); return; }
    if (draft.siteLimit === '' && draft.userLimit === '') { setFormError('至少填写全站或单用户日预算。'); return; }
    setFormError('');
    onSaveBudget(draft);
  }

  function submitBreaker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!breakerReason.trim()) { setFormError('请填写操作理由，会写入管理审计。'); return; }
    setFormError('');
    onSaveBreaker(breakerEnabled, breakerReason.trim(), circuitBreakerVersion);
  }

  return (
    <AdminPanel
      title="预算与熔断"
      description="按币种分别设置日预算；熔断只影响后续新请求，在途调用不会中断。"
      badge={<Badge variant={circuitBreaker === 'enabled' ? 'success' : circuitBreaker === 'invalid' ? 'danger' : 'neutral'}>熔断{breakerLabel}</Badge>}
      flush
    >
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-2 px-5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {open ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
        高级设置：日预算与熔断（{rows.length} 个币种）
      </button>
      {open && (
        <div id={panelId} className="space-y-4 border-t border-border p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>配置来源：{source === 'DATABASE' ? '后台数据库' : source === 'ENVIRONMENT' ? '服务器环境变量' : '未配置'}</span>
            <span>·</span>
            <span>状态：{status === 'enabled' ? '可用' : status === 'invalid' ? '格式错误' : '未配置'}</span>
          </div>

          {rows.length === 0 && (
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">尚未保存数据库预算；未配置价格和预算时不会推测或扣除费用。</p>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map(row => (
              <article key={row.currency} className="min-w-0 space-y-1 rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{row.currency} · {row.isActive ? '启用' : '已停用'}</h3>
                  <span className="text-xs text-muted-foreground">版本 {row.version}</span>
                </div>
                <p className="break-words text-xs text-muted-foreground">
                  全站：{row.siteLimit === null ? '未设置' : formatAmount(row.siteLimit, row.currency)} / 日 · 单用户：{row.userLimit === null ? '未设置' : formatAmount(row.userLimit, row.currency)} / 日
                </p>
                <p className="text-xs text-muted-foreground">更新于 {formatDateTime(row.updatedAt)}</p>
                {canManage && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setFormError(''); setDraft(emptyDraft(row)); }}>编辑预算</Button>
                )}
              </article>
            ))}
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setFormError(''); setDraft(emptyDraft()); }}>新增币种预算</Button>
              <Button size="sm" variant="outline" leadingIcon={<ShieldOff className="h-3.5 w-3.5" />} disabled={busy} onClick={() => { setFormError(''); setBreakerEnabled(circuitBreaker === 'enabled'); setBreakerReason(''); setBreakerOpen(true); }}>
                调整熔断策略
              </Button>
            </div>
          )}

          <p className="text-xs leading-5 text-muted-foreground">
            启用熔断前需要为全部可用模型配置生效成本价，并为每种计价币种配置有效日预算；否则保存会被拒绝。
          </p>
        </div>
      )}

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.isExisting ? `编辑 ${draft.currency} 预算` : '新增币种预算'}
        description="设置预算不代表模型单价已确认；未知费用仍单独标记。保存会写入管理审计。"
        footer={
          <>
            <Button variant="outline" onClick={() => setDraft(null)}>取消</Button>
            <Button type="submit" form="ai-budget-form" loading={busy}>{busy ? '保存中…' : '保存预算'}</Button>
          </>
        }
      >
        {draft && (
          <form id="ai-budget-form" onSubmit={submitBudget} className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">币种代码</span>
              <Input required disabled={draft.isExisting} maxLength={3} pattern="[A-Za-z]{3}" className="uppercase" value={draft.currency} onChange={event => setDraft({...draft, currency: event.target.value.toUpperCase()})} />
            </label>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium">预算状态</span>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} onChange={event => setDraft({...draft, isActive: event.target.checked})} />
                参与新请求预算判断
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">全站每日预算</span>
              <Input type="number" min="0.000001" step="0.000001" inputMode="decimal" value={draft.siteLimit} onChange={event => setDraft({...draft, siteLimit: event.target.value})} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">单用户每日预算</span>
              <Input type="number" min="0.000001" step="0.000001" inputMode="decimal" value={draft.userLimit} onChange={event => setDraft({...draft, userLimit: event.target.value})} />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium">操作理由</span>
              <Input required maxLength={300} value={draft.reason} onChange={event => setDraft({...draft, reason: event.target.value})} />
            </label>
            {formError && <div className="sm:col-span-2"><AdminNotice tone="error" title={formError} /></div>}
          </form>
        )}
      </Dialog>

      <Dialog
        open={breakerOpen}
        onClose={() => setBreakerOpen(false)}
        title="调整预算熔断"
        description="达到预算后是否拒绝新的 AI 调用；已接纳的请求继续执行，可能越过阈值。"
        footer={
          <>
            <Button variant="outline" onClick={() => setBreakerOpen(false)}>取消</Button>
            <Button type="submit" form="ai-breaker-form" loading={busy}>{busy ? '保存中…' : '保存策略'}</Button>
          </>
        }
      >
        <form id="ai-breaker-form" onSubmit={submitBreaker} className="space-y-4">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={breakerEnabled} onChange={event => setBreakerEnabled(event.target.checked)} />
            达到预算后拒绝新的 AI 调用
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">操作理由</span>
            <Input required maxLength={300} value={breakerReason} onChange={event => setBreakerReason(event.target.value)} />
          </label>
          {formError && <AdminNotice tone="error" title={formError} />}
        </form>
      </Dialog>
    </AdminPanel>
  );
}
