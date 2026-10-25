export type ReaderPreferences = {
  fontSize: 'standard' | 'large' | 'larger';
  lineSpacing: 'standard' | 'relaxed';
  bubbleStyle: 'soft' | 'plain';
  streamDisplayMode: 'stream' | 'complete';
  sendKey: 'enter' | 'modifier-enter';
  speechRate: 0.75 | 1 | 1.25 | 1.5;
};
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: 'standard', lineSpacing: 'standard', bubbleStyle: 'soft',
  streamDisplayMode: 'stream', sendKey: 'enter', speechRate: 1,
};
const OPTIONS = {
  fontSize: ['standard', 'large', 'larger'], lineSpacing: ['standard', 'relaxed'],
  bubbleStyle: ['soft', 'plain'], streamDisplayMode: ['stream', 'complete'],
  sendKey: ['enter', 'modifier-enter'], speechRate: [0.75, 1, 1.25, 1.5],
} as const;
export function validateReaderPreferences(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '阅读偏好格式无效。';
  for (const [key, item] of Object.entries(value)) {
    const allowed = OPTIONS[key as keyof ReaderPreferences] as readonly unknown[] | undefined;
    if (!allowed || !allowed.includes(item)) return '阅读偏好选项无效：' + key;
  }
  return null;
}
export function normalizeReaderPreferences(raw: unknown, legacyReadingMode = false): ReaderPreferences {
  let value = raw;
  if (typeof raw === 'string') try {value = JSON.parse(raw);} catch {value = null;}
  const base = {...DEFAULT_READER_PREFERENCES, ...(legacyReadingMode ? {fontSize: 'large' as const} : {})};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  for (const [key, item] of Object.entries(value)) {
    const allowed = OPTIONS[key as keyof ReaderPreferences] as readonly unknown[] | undefined;
    if (allowed?.includes(item)) Object.assign(base, {[key]: item});
  }
  return base;
}
export interface Shortcut {label: string; text: string}
export const MAX_SHORTCUTS = 12;
export const MAX_SHORTCUT_LABEL = 24;
export const MAX_SHORTCUT_TEXT = 300;
export function validateShortcuts(raw: unknown): string | null {
  let value = raw;
  if (typeof raw === 'string') try {value = JSON.parse(raw);} catch {return '快捷语须为有效JSON数组。';}
  if (!Array.isArray(value) || value.length > MAX_SHORTCUTS) return '快捷语最多 ' + MAX_SHORTCUTS + ' 条。';
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['label', 'text'].includes(key))) return '快捷语格式无效。';
    if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > MAX_SHORTCUT_LABEL || typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_SHORTCUT_TEXT) return '快捷语名称或内容为空或超出长度。';
  }
  return null;
}
