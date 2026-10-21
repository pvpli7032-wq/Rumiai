'use client';

import {FlaskConical} from 'lucide-react';
import {useState} from 'react';
import {API} from '@/lib/api-paths';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import type {SettingDefinition} from '@/lib/settings/types';

/**
 * 提示词试生成（V3 §16）：改完模板先跑一条，看结果对不对，再决定保不保存。
 *
 * 试生成读的是**已保存**的模板，不读草稿 —— 它验证的是线上正在用的那份；
 * 草稿要先保存才会生效，这一点在按钮下方写清楚，避免误以为试跑的就是新模板。
 * 失败时直接显示失败原因，不拿占位文本冒充结果。
 */
export function PromptPreview({definition, token, saved}: {
  definition: SettingDefinition;
  token: string;
  /** 当前已保存的模板内容；草稿不同则提示先保存。 */
  saved: string;
}) {
  const [sample, setSample] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState('');

  async function run() {
    setBusy(true); setError(''); setResult(null); setMeta('');
    try {
      const response = await fetch(API.admin.settingsPromptPreview, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({key: definition.key, sample}),
      });
      const payload = await response.json().catch(() => null) as {result?: string; model?: string | null; error?: string} | null;
      if (!response.ok) throw new Error(payload?.error || '试生成失败，请稍后重试。');
      setResult(payload?.result ?? '');
      setMeta(payload?.model ? `模型：${payload.model}` : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '试生成失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground">试生成</h4>
        <Button size="sm" variant="outline" onClick={() => void run()} loading={busy} disabled={!sample.trim()}
          leadingIcon={<FlaskConical aria-hidden className="h-3.5 w-3.5" />}>
          用已保存的模板试一次
        </Button>
      </div>
      <Textarea aria-label={`${definition.label}试生成的示例输入`} rows={3} value={sample}
        placeholder="填一段示例输入，例如用户的三道题回答或一段对话摘录" onChange={event => setSample(event.target.value)} />
      <p className="text-xs leading-5 text-muted-foreground">
        试生成用的是已经保存的模板（不是上面未保存的草稿）。它是一次真实模型调用，成本照常计入，不扣用户金币。
        {saved.trim() ? '' : ' 这项提示词还没有保存过内容，先填写并保存再试。'}
      </p>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5">{error}</p>}
      {result !== null && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">生成结果{meta ? `（${meta}）` : ''}</p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-3 text-xs leading-5">{result || '（模型返回了空内容）'}</pre>
        </div>
      )}
    </div>
  );
}
