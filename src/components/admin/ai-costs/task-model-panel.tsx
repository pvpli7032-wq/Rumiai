'use client';

import {useState} from 'react';
import {AdminNotice, AdminPanel} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Select} from '@/components/ui/select';
import {apiFetch} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import type {CoinPriceView} from './types';

/**
 * 各任务用哪个模型（V3 §22）。
 *
 * 只写一个模型 key 到设置中心，不复制供应商配置：供应商地址与密钥仍然只有一份，
 * 任务只是「这个任务优先用哪个已登记的模型」。选「沿用默认」= 保存空串，
 * 也就是回到未配置状态，行为与引入这个功能之前完全一致。
 */
export function TaskModelPanel({view, token, canWrite, onSaved}: {
  view: CoinPriceView;
  token: string;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.taskModels.map(item => [item.setting, item.modelKey])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const dirty = view.taskModels.filter(item => (draft[item.setting] ?? '') !== item.modelKey);
  const active = view.modelOptions.filter(model => model.available);

  async function save() {
    if (!canWrite || busy || dirty.length === 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(API.admin.settings, {
        token,
        method: 'PATCH',
        body: {
          group: 'billing',
          changes: dirty.map(item => ({key: item.setting, value: draft[item.setting] ?? ''})),
          expectedVersions: {},
        },
      });
      setNotice(`已保存 ${dirty.length} 个任务的模型选择；下一次调用生效。`);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPanel
      title="各任务用哪个模型"
      description="每个 AI 任务可以单独指定一个已登记的模型；留空沿用默认模型计划（默认模型 + 兜底）。输出上限与重试次数仍取模型自身设置。"
      badge={dirty.length > 0 ? <Badge variant="warning">{dirty.length} 项待保存</Badge> : undefined}
      actions={
        <Button size="sm" onClick={() => void save()} loading={busy} disabled={!canWrite || dirty.length === 0}>
          保存模型选择
        </Button>
      }
    >
      {!canWrite && (
        <AdminNotice tone="info" title="当前为只读查看" description="修改任务模型需要「保存运营设置」权限。" />
      )}
      {error && <AdminNotice tone="error" title={error} className="mb-3" />}
      {notice && <AdminNotice tone="success" title={notice} className="mb-3" />}

      <div className="divide-y divide-border">
        {view.taskModels.map(item => {
          const current = draft[item.setting] ?? '';
          const configured = view.modelOptions.find(model => model.key === item.modelKey);
          const unavailable = Boolean(item.modelKey) && !configured?.available;
          return (
            <div key={item.setting} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <label htmlFor={`task-model-${item.task}`} className="block text-sm font-medium text-foreground">{item.label}</label>
                <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">{item.setting}</span>
                {unavailable && (
                  <span className="mt-1 block text-xs text-amber-600">
                    已配置的「{item.modelKey}」不在在售模型里，该任务当前回落到默认模型计划，请重新选择。
                  </span>
                )}
              </div>
              <div className="w-full shrink-0 sm:w-64">
                <Select
                  id={`task-model-${item.task}`}
                  aria-label={`${item.label}用哪个模型`}
                  value={current}
                  disabled={!canWrite || busy}
                  onChange={event => setDraft(prev => ({...prev, [item.setting]: event.target.value}))}
                >
                  <option value="">沿用默认模型计划</option>
                  {active.map(model => <option key={model.key} value={model.key}>{model.displayName}（{model.key}）</option>)}
                  {unavailable && <option value={item.modelKey}>{item.modelKey}（已不可用）</option>}
                </Select>
              </div>
            </div>
          );
        })}
      </div>

      {active.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">还没有在售模型：先在「模型服务」登记并启用模型，再回来为任务指定模型。</p>
      )}
    </AdminPanel>
  );
}
