'use client';

import {ChevronDown, Maximize2, RotateCcw} from 'lucide-react';
import {useId, useState} from 'react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Select} from '@/components/ui/select';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/components/ui/cn';
import type {JsonValue, SettingDefinition, SettingSource} from '@/lib/settings/types';
import {SOURCE_LABELS, formatSettingValue, rangeHint} from './format';

/**
 * 一行设置：中文名称 + 控件 + 单位 + 一行说明（V3 §16）。
 *
 * 技术键、默认值、来源、版本收在「字段详情」里，默认不占版面。
 * 手机端名称与控件上下排列，控件占满宽度，不出现整页横向滚动。
 */
export interface SettingFieldProps {
  definition: SettingDefinition;
  value: JsonValue;
  source: SettingSource;
  version: number;
  dirty: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (value: JsonValue) => void;
  /** 把这一项改回登记默认值（只改草稿，不提交）。 */
  onResetToDefault: () => void;
  /** 有用户特例时提示继承关系。 */
  userOverride?: boolean;
}

export function SettingField({
  definition,
  value,
  source,
  version,
  dirty,
  error,
  disabled = false,
  onChange,
  onResetToDefault,
  userOverride = false,
}: SettingFieldProps) {
  const inputId = useId();
  const errorId = useId();
  const [details, setDetails] = useState(false);
  const [zoom, setZoom] = useState(false);
  const description = definition.description;

  const control = renderControl();

  return (
    <div
      className={cn(
        'flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:gap-6',
        error && 'bg-destructive/5',
      )}
      data-setting-key={definition.key}
    >
      <div className="min-w-0 sm:w-56 sm:shrink-0">
        <label htmlFor={inputId} className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {definition.label}
          {dirty && <Badge variant="warning" size="sm">未保存</Badge>}
        </label>
        {definition.unit && <p className="mt-0.5 text-xs text-muted-foreground">单位：{definition.unit}</p>}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        {control}
        {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
        {error && (
          <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => setDetails(current => !current)}
            aria-expanded={details}
            className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown aria-hidden className={cn('h-3 w-3 transition-transform', details && 'rotate-180')} />
            字段详情
          </button>
          <span className="text-xs text-muted-foreground">·</span>
          <button
            type="button"
            onClick={onResetToDefault}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw aria-hidden className="h-3 w-3" />
            恢复默认值
          </button>
        </div>
        {details && (
          <dl className="grid gap-1 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
            <div className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-muted-foreground">技术键</dt>
              <dd className="min-w-0 break-all font-mono text-foreground">{definition.key}</dd>
            </div>
            <div className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-muted-foreground">默认值</dt>
              <dd className="min-w-0 break-words text-foreground">{formatSettingValue(definition, definition.default)}</dd>
            </div>
            <div className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-muted-foreground">来源</dt>
              <dd className="min-w-0 text-foreground">{SOURCE_LABELS[source]}</dd>
            </div>
            <div className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-muted-foreground">版本</dt>
              <dd className="min-w-0 text-foreground">{version}</dd>
            </div>
            <div className="flex min-w-0 gap-2 sm:col-span-2">
              <dt className="shrink-0 text-muted-foreground">使用位置</dt>
              <dd className="min-w-0 break-words text-foreground">
                {userOverride ? '可对单个用户设置特例，特例优先于这里的公共值。' : '全站生效；不允许按用户单独覆盖。'}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {zoom && (
        <Dialog
          open
          onClose={() => setZoom(false)}
          title={definition.label}
          description="放大编辑，内容与原输入框同步。"
          size="xl"
        >
          <Textarea
            aria-label={`${definition.label}（放大编辑）`}
            rows={18}
            value={String(value ?? '')}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
          />
        </Dialog>
      )}
    </div>
  );

  function renderControl() {
    const invalid = Boolean(error);
    const describedBy = error ? errorId : undefined;

    switch (definition.type) {
      case 'boolean':
        return (
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2">
            <span className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors', value === true ? 'border-brand bg-brand' : 'border-border bg-muted', disabled && 'opacity-50')}>
              <input
                id={inputId}
                type="checkbox"
                role="switch"
                aria-describedby={describedBy}
                checked={value === true}
                disabled={disabled}
                onChange={event => onChange(event.target.checked)}
                className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
              />
              <span
                aria-hidden
                className={cn('pointer-events-none ml-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform', value === true && 'translate-x-4')}
              />
            </span>
            <span className="text-sm text-foreground">{value === true ? '开启' : '关闭'}</span>
          </label>
        );
      case 'enum':
        return (
          <Select
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={String(value ?? '')}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
            className="max-w-sm"
          >
            {(definition.options ?? []).map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        );
      case 'text':
        return (
          <div className="space-y-1.5">
            <Textarea
              id={inputId}
              aria-describedby={describedBy}
              rows={4}
              value={String(value ?? '')}
              disabled={disabled}
              onChange={event => onChange(event.target.value)}
            />
            <Button size="sm" variant="outline" onClick={() => setZoom(true)} leadingIcon={<Maximize2 aria-hidden className="h-3.5 w-3.5" />}>
              放大编辑
            </Button>
          </div>
        );
      case 'json':
        return (
          <Textarea
            id={inputId}
            aria-describedby={describedBy}
            rows={4}
            className="font-mono"
            value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
          />
        );
      case 'number':
        return (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={inputId}
              type="number"
              inputMode="numeric"
              aria-describedby={describedBy}
              invalid={invalid}
              className="max-w-40"
              value={value === null || value === undefined ? '' : String(value)}
              min={definition.min}
              max={definition.max}
              step={1}
              disabled={disabled}
              onChange={event => {
                const text = event.target.value;
                onChange(text === '' ? null : Number(text));
              }}
            />
            {definition.unit && <span className="text-sm text-muted-foreground">{definition.unit}</span>}
            <span className="text-xs text-muted-foreground">{rangeHint(definition)}</span>
          </div>
        );
      default:
        return (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            className="max-w-sm"
            value={String(value ?? '')}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
          />
        );
    }
  }
}
