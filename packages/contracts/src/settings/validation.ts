import {normalizeRelationshipLevels} from '@rumiai/contracts/conversations/relationship';
import type {JsonValue, SettingDefinition} from '@rumiai/contracts/settings/types';

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
      // 为什么按「登记默认值是否为空串」判断，而不是按 key 前缀或给类型加标记：
      // 默认值是这一项「未设置」时的形态，它本身就是最权威的语义声明 ——
      // 默认 '' 的项（ai.taskModel.*：留空 = 沿用默认模型计划）空串是合法状态，
      // 默认非 '' 的项（prompt.*：空模板等于让模型没有指令）空串仍是错误输入。
      // 这条规则覆盖所有 text 项，没有例外名单；不要把它当成漏洞「顺手修掉」，
      // 那会把「沿用默认」重新堵死 —— 后台点保存会直接 400。
      if (!value) {
        if (def.default === '') return '';
        fail(def, '不能为空。');
      }
      if (value.length > 8000) fail(def, '长度不能超过 8000。');
      return value;
    }
    case 'json': {
      if (raw === null || raw === undefined) fail(def, '需要 JSON 值。');
      let value = raw;
      if (typeof raw === 'string') {
        try { value = JSON.parse(raw); } catch { return fail(def, '不是合法 JSON。'); }
      }
      if (def.key === 'relationship.romanceLevels' || def.key === 'relationship.intimacyLevels') {
        try { return normalizeRelationshipLevels(value) as unknown as JsonValue; }
        catch (error) { return fail(def, error instanceof Error ? error.message : '关系等级无效。'); }
      }
      if (def.key === 'growth.openingSuggestions') {
        if (!Array.isArray(value) || value.some(text => typeof text !== 'string' || !text.trim())) return fail(def, '开场建议必须是不含空项的文字数组。');
        return [...new Set(value.map(text => (text as string).trim()))] as JsonValue;
      }
      return value as JsonValue;
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
