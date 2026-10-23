import type {JsonValue, SettingDefinition, SettingSource} from '@rumiai/contracts/settings/types';

/** 两个设置值是否相同；设置值只会是 JSON 基本类型或数组/对象，序列化比较足够。 */
export function sameSettingValue(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const SOURCE_LABELS: Record<SettingSource, string> = {
  USER: '用户特例',
  GLOBAL: '后台已保存',
  DEFAULT: '登记默认值',
};

export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + '…' : value;
}

/** 把设置值写成一句人话，用于字段详情、恢复默认的影响预览。 */
export function formatSettingValue(definition: SettingDefinition, value: JsonValue): string {
  if (value === null || value === undefined) return '未设置';
  switch (definition.type) {
    case 'boolean':
      return value ? '开启' : '关闭';
    case 'enum':
      return definition.options?.find(option => option.value === value)?.label ?? String(value);
    case 'text':
      return truncate(String(value), 60);
    case 'json':
      return truncate(JSON.stringify(value), 60);
    case 'number':
      return definition.unit ? `${value} ${definition.unit}` : String(value);
    default:
      return String(value);
  }
}

/** 文本类设置的长度上限；校验与字段详情共用同一份数字。 */
export const TEXT_MAX_CHARS = 8000;
export const STRING_MAX_CHARS = 200;

/** 数值输入框下方的可填范围提示。 */
export function rangeHint(definition: SettingDefinition): string {
  if (definition.type !== 'number') return '';
  if (definition.min !== undefined && definition.max !== undefined) {
    return `可填 ${definition.min}–${definition.max}${definition.unit ?? ''}`;
  }
  if (definition.min !== undefined) return `不小于 ${definition.min}${definition.unit ?? ''}`;
  if (definition.max !== undefined) return `不大于 ${definition.max}${definition.unit ?? ''}`;
  return '';
}

/**
 * 字段详情里的「可输入范围」（V3 §85：建议值、可输入范围和当前值分开显示）。
 *
 * 数值取登记的 min/max，枚举列出全部可选值，文本类说明长度上限，
 * 开关与 JSON 没有范围。默认值就是「建议值」，当前值在控件里，三者不混在一行。
 */
export function rangeText(definition: SettingDefinition): string {
  switch (definition.type) {
    case 'number':
      return rangeHint(definition) || '不限';
    case 'enum':
      return (definition.options ?? []).map(option => option.label).join(' / ') || '不限';
    case 'text':
      return `不超过 ${TEXT_MAX_CHARS} 字`;
    case 'string':
      return `不超过 ${STRING_MAX_CHARS} 字`;
    default:
      return '不限';
  }
}

/**
 * 保存前先按与服务端 `normalizeSettingValue` 相同的规则检查一遍。
 *
 * 目的只是把错误挂到具体字段上，省掉一次往返；服务端仍然是权威校验，
 * 这里不新增任何服务端没有的规则，也不放宽任何一条。
 */
export function validateSettingValue(definition: SettingDefinition, value: JsonValue): string | null {
  switch (definition.type) {
    case 'number': {
      if (value === null || value === undefined || value === '') {
        return definition.default === null ? null : '需要填写数值。';
      }
      const number = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(number) || !Number.isInteger(number)) return '必须是整数。';
      if (definition.min !== undefined && number < definition.min) return `不能小于 ${definition.min}。`;
      if (definition.max !== undefined && number > definition.max) return `不能大于 ${definition.max}。`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : '只能是开或关。';
    case 'enum':
      return definition.options?.some(option => option.value === value) ? null : '不是可选项之一。';
    case 'string': {
      const text = String(value ?? '').trim();
      if (!text) return '不能为空。';
      return text.length > STRING_MAX_CHARS ? `长度不能超过 ${STRING_MAX_CHARS}。` : null;
    }
    case 'text': {
      const text = String(value ?? '').trim();
      if (!text) return '不能为空。';
      return text.length > TEXT_MAX_CHARS ? `长度不能超过 ${TEXT_MAX_CHARS}。` : null;
    }
    case 'json': {
      if (value === null || value === undefined) return '需要 JSON 值。';
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
        } catch {
          return '不是合法 JSON。';
        }
      }
      return null;
    }
    default:
      return '未知类型。';
  }
}
