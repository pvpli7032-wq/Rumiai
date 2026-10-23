'use client';

import {Download, FileUp} from 'lucide-react';
import {useRef, useState} from 'react';
import {API} from '@/lib/api-paths';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {SETTINGS_BY_KEY} from '@/lib/settings/registry';
import type {JsonValue} from '@/lib/settings/types';
import {formatSettingValue, truncate} from './format';

/**
 * 设置导出 / 导入（V3 表 10「如何共享」）。
 *
 * 导出只含公共参数：文件里没有用户特例，也没有任何凭据（供应商密钥、支付商户、
 * 数据库路径存在各自的数据表，本来就不在参数登记表里）。
 * 导入先只算差异、不写库；管理员看清哪些会改，再一次确认写入。
 */
type ImportAction = 'change' | 'same' | 'unknown-key';

interface DiffRow {
  key: string;
  current: JsonValue | null;
  incoming: JsonValue | null;
  version: number;
  action: ImportAction;
}

const ACTION_LABELS: Record<ImportAction, string> = {'change': '将修改', 'same': '无变化', 'unknown-key': '未登记'};

function labelOf(key: string): string {
  return SETTINGS_BY_KEY[key]?.label ?? key;
}

function showValue(key: string, value: JsonValue | null): string {
  if (value === null) return '—';
  const definition = SETTINGS_BY_KEY[key];
  if (!definition) return truncate(JSON.stringify(value), 60);
  return formatSettingValue(definition, value);
}

export function ExportImportDialog({open, sessionActive, canWrite, onClose, onImported}: {
  open: boolean;
  sessionActive: boolean;
  canWrite: boolean;
  onClose: () => void;
  /** 导入成功后通知设置中心重新读取，避免页面还显示旧值。 */
  onImported: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{saved: number; skipped: number} | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setRows(null); setFileName(''); setNotice(''); setError(''); setDone(null);
  }

  async function exportFile() {
    setExporting(true); setError('');
    try {
      const response = await fetch(API.admin.settingsExport, {credentials: 'include', cache: 'no-store'});
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as {error?: string} | null;
        throw new Error(payload?.error || '导出失败，请稍后重试。');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `settings-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('已导出公共参数文件。文件里不含用户特例与任何凭据。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败，请稍后重试。');
    } finally {
      setExporting(false);
    }
  }

  async function previewImport(file: File) {
    setBusy(true); setError(''); setNotice(''); setDone(null);
    try {
      const parsed = JSON.parse(await file.text()) as {values?: unknown};
      const values = parsed && typeof parsed === 'object' && parsed.values && typeof parsed.values === 'object' ? parsed.values : parsed;
      const response = await fetch(API.admin.settingsImport, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({values}),
      });
      const payload = await response.json().catch(() => null) as {items?: DiffRow[]; error?: string} | null;
      if (!response.ok) throw new Error(payload?.error || '读取导入文件失败。');
      setFileName(file.name);
      setRows(payload?.items ?? []);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? `无法读取导入文件：${e.message}` : '无法读取导入文件。');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function confirmImport() {
    if (!rows) return;
    setBusy(true); setError('');
    try {
      const values = Object.fromEntries(rows.map(row => [row.key, row.incoming]));
      const expectedVersions = Object.fromEntries(rows.map(row => [row.key, row.version]));
      const response = await fetch(API.admin.settingsImportConfirm, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({values, expectedVersions}),
      });
      const payload = await response.json().catch(() => null) as {saved?: string[]; skipped?: number; error?: string} | null;
      if (!response.ok) throw new Error(payload?.error || '导入失败，请稍后重试。');
      setDone({saved: payload?.saved?.length ?? 0, skipped: payload?.skipped ?? 0});
      setRows(null);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  const changes = rows?.filter(row => row.action === 'change') ?? [];
  const unknown = rows?.filter(row => row.action === 'unknown-key') ?? [];

  return (
    <Dialog
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="导出 / 导入公共参数"
      description="导出得到一个 JSON 文件；导入先显示差异，确认后才写入，且一次事务内完成。"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>关闭</Button>
          {canWrite && rows && changes.length > 0 && unknown.length === 0 && (
            <Button onClick={() => void confirmImport()} loading={busy}>确认导入 {changes.length} 项</Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <section className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">导出</h3>
          <p className="text-xs leading-5 text-muted-foreground">只导出公共参数值，不含用户特例、不含供应商密钥或支付配置等凭据。</p>
          <Button variant="outline" size="sm" onClick={() => void exportFile()} loading={exporting} leadingIcon={<Download aria-hidden className="h-4 w-4" />}>
            下载参数文件
          </Button>
        </section>

        <section className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">导入</h3>
          {!canWrite ? (
            <p className="text-xs text-muted-foreground">导入需要「保存运营设置」权限。</p>
          ) : (
            <>
              <p className="text-xs leading-5 text-muted-foreground">选择之前导出的文件；先看差异，确认后一次写入。含未登记键的文件会被整批拒绝。</p>
              <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label="选择参数文件"
                onChange={event => { const file = event.target.files?.[0]; if (file) void previewImport(file); }} />
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} loading={busy} leadingIcon={<FileUp aria-hidden className="h-4 w-4" />}>
                选择文件
              </Button>
              {fileName && <p className="text-xs text-muted-foreground">已读取：{fileName}</p>}
            </>
          )}
        </section>

        {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">{notice}</p>}
        {done && (
          <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
            导入完成：写入 {done.saved} 项，跳过 {done.skipped} 项无变化的设置。
          </p>
        )}
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}

        {rows && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-foreground">差异预览</span>
              <Badge variant="warning">{changes.length} 项将修改</Badge>
              <Badge variant="neutral">{rows.length - changes.length - unknown.length} 项无变化</Badge>
              {unknown.length > 0 && <Badge variant="danger">{unknown.length} 项未登记</Badge>}
            </div>
            {unknown.length > 0 && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5">
                文件里有本系统未登记的设置键（{unknown.slice(0, 3).map(row => row.key).join('、')}{unknown.length > 3 ? ' 等' : ''}），整批不会写入。请确认文件来自同一版本的站点。
              </p>
            )}
            <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
              <table className="w-full min-w-0 text-left text-sm">
                <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">设置项</th>
                    <th scope="col" className="px-3 py-2 font-medium">当前值</th>
                    <th scope="col" className="px-3 py-2 font-medium">导入值</th>
                    <th scope="col" className="px-3 py-2 font-medium">结果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(row => (
                    <tr key={row.key} className={row.action === 'unknown-key' ? 'bg-destructive/5' : undefined}>
                      <td className="px-3 py-2 align-top">
                        <span className="block font-medium text-foreground">{labelOf(row.key)}</span>
                        <span className="block break-all font-mono text-xs text-muted-foreground">{row.key}</span>
                      </td>
                      <td className="px-3 py-2 align-top break-words text-xs">{showValue(row.key, row.current)}</td>
                      <td className="px-3 py-2 align-top break-words text-xs">{showValue(row.key, row.incoming)}</td>
                      <td className="px-3 py-2 align-top text-xs">{ACTION_LABELS[row.action]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
