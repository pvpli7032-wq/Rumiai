import type {JsonValue, SettingDefinition} from './types';

export class SettingValidationError extends Error {
  constructor(readonly key: string, message: string) {
    super(message);
    this.name = 'SettingValidationError';
  }
}

function fail(def: SettingDefinition, message: string): never {
  throw new SettingValidationError(def.key, message);
}

/** 把任意输入收敛成该设置定义允许的值；不合法就抛 SettingValidationError。 */
export function normalizeSettingValue(def: SettingDefinition, raw: unknown): JsonValue {
  switch (def.type) {
    case 'number': {
      if (raw === null || raw === undefined || raw === '') {
        if (def.default === null) return null;
        fail(def, '需要填写数值。');
      }
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) fail(def, '需要填写数值。');
      if (!def.decimal && !Number.isInteger(value)) fail(def, '必须是整数。');
      if (def.min !== undefined && value < def.min) fail(def, '不能小于 ' + def.min + '。');
      if (def.max !== undefined && value > def.max) fail(def, '不能大于 ' + def.max + '。');
      return value;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return fail(def, '只能是开或关。');
    }
    case 'enum': {
      const value = String(raw ?? '');
      if (!def.options?.some(option => option.value === value)) fail(def, '不是可选项之一。');
      return value;
    }
    case 'string': {
      const value = String(raw ?? '').trim();
      if (!value) fail(def, '不能为空。');
      if (value.length > 200) fail(def, '长度不能超过 200。');
      return value;
    }
    case 'text': {
      const value = String(raw ?? '').trim();
      if (!value) fail(def, '不能为空。');
      if (value.length > 8000) fail(def, '长度不能超过 8000。');
      return value;
    }
    case 'json': {
      if (raw === null || raw === undefined) fail(def, '需要 JSON 值。');
      if (typeof raw === 'string') {
        try { return JSON.parse(raw) as JsonValue; } catch { return fail(def, '不是合法 JSON。'); }
      }
      return raw as JsonValue;
    }
    default:
      return fail(def, '未知类型。');
  }
}

/** 落库形态：统一 JSON 字符串，读取方按定义的类型解析。 */
export function serializeSettingValue(value: JsonValue): string {
  return JSON.stringify(value);
}

export function parseStoredValue(def: SettingDefinition, stored: string): JsonValue {
  try {
    return normalizeSettingValue(def, JSON.parse(stored));
  } catch {
    // 库里存了坏值时回落默认值，不把坏数据抛给业务调用方。
    return def.default;
  }
}
