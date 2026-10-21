import {SETTINGS_BY_KEY, readSettings, SettingValidationError} from '@/lib/settings';
import type {JsonValue} from '@/lib/settings';
import {isRegisteredKey} from './_input';

/**
 * 设置导出与导入（V3 表 10「如何共享」）。
 *
 * 导出只按登记表逐项读公共值，且不带 userId：读到的一定是公共值或登记默认值，
 * 用户特例不可能被带出去。凭据（供应商密钥、支付商户、数据库路径）本来就不在
 * 登记表里，它们存在各自的数据表，因此导出文件里也不会出现。
 */
const EXPORT_VERSION = 1;

interface SettingsExportFile {
  version: number;
  exportedAt: string;
  values: Record<string, JsonValue>;
}

export async function buildExportFile(): Promise<SettingsExportFile> {
  const keys = Object.keys(SETTINGS_BY_KEY);
  const values = await readSettings(keys);
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    values: Object.fromEntries(values.map(item => [item.key, item.value])),
  };
}

type ImportAction = 'change' | 'same' | 'unknown-key';

interface ImportDiffRow {
  key: string;
  /** 当前公共值；未登记的键为 null。 */
  current: JsonValue | null;
  incoming: JsonValue | null;
  /** 当前公共版本，确认时原样回传做并发校验。 */
  version: number;
  action: ImportAction;
}

/** 导入文件里的 values：必须是键值对象；未登记的键保留下来，由差异表标成 unknown-key。 */
export function parseImportValues(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SettingValidationError('', '导入文件缺少参数值。');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length) throw new SettingValidationError('', '导入文件里没有可导入的参数。');
  if (entries.length > 200) throw new SettingValidationError('', '一次导入的参数过多。');
  return Object.fromEntries(entries);
}

/** 只读的差异计算：不写库，供预览接口与确认接口共用，两边不会算出两套结论。 */
export async function buildImportDiff(values: Record<string, unknown>): Promise<ImportDiffRow[]> {
  const known = Object.keys(values).filter(isRegisteredKey);
  const current = new Map((await readSettings(known)).map(item => [item.key, item]));
  return Object.entries(values).map(([key, incoming]) => {
    const item = current.get(key);
    if (!item) return {key, current: null, incoming: incoming as JsonValue, version: 0, action: 'unknown-key' as const};
    const action = JSON.stringify(item.value) === JSON.stringify(incoming) ? 'same' : 'change';
    return {key, current: item.value, incoming: incoming as JsonValue, version: item.version, action};
  });
}
