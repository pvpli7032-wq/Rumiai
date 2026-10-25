export type ResponseOption = {key: string; label: string; instruction: string};
export function normalizeResponseOptions(value: unknown): ResponseOption[] {
  if (!Array.isArray(value) || value.length > 20) throw Error('回复选项须为最多20项的数组。');
  const seen = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('每项须包含key、label和instruction。');
    const entry = row as Record<string, unknown>;
    if (Object.keys(entry).some(key => !['key', 'label', 'instruction'].includes(key))) throw Error('回复选项包含未声明字段。');
    if (typeof entry.key !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.key) || seen.has(entry.key)) throw Error('选项key须唯一，使用字母、数字、下划线或短横线。');
    if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 80) throw Error('选项名称须为1–80字。');
    if (typeof entry.instruction !== 'string' || !entry.instruction.trim() || entry.instruction.length > 4000) throw Error('选项指令须为1–4000字。');
    seen.add(entry.key);
    return {key: entry.key, label: entry.label.trim(), instruction: entry.instruction.trim()};
  });
}
