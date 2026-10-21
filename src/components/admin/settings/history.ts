import type {JsonValue} from '@/lib/settings/types';

/** 修改历史条目：oldValue/newValue 是落库时的 JSON 字符串，null 表示从未设置过。 */
export interface SettingRevision {
  id: string;
  key: string;
  scope: string;
  oldValue: string | null;
  newValue: string | null;
  operatorId: string;
  createdAt: string;
}

function parse(stored: string | null): {ok: boolean; value: JsonValue} {
  if (stored === null) return {ok: true, value: null};
  try {
    return {ok: true, value: JSON.parse(stored) as JsonValue};
  } catch {
    return {ok: false, value: null};
  }
}

/** 历史值按登记类型格式化；坏数据原样展示，不隐藏。 */
export function formatStoredValue(stored: string | null): string {
  const parsed = parse(stored);
  if (!parsed.ok) return stored ?? '—';
  return formatRaw(parsed.value);
}

function formatRaw(value: JsonValue): string {
  if (value === null) return '未设置';
  if (typeof value === 'boolean') return value ? '开启' : '关闭';
  if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '…' : value;
  if (typeof value === 'number') return String(value);
  const text = JSON.stringify(value);
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}
