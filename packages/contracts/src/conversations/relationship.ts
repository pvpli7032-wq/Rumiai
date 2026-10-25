export interface RelationshipLevel {name: string; from: number}
export interface RelationshipPolicy {romanceLevels: RelationshipLevel[]; intimacyLevels: RelationshipLevel[]; romancePerReply: number; intimacyPerReply: number}
export interface RelationshipMeter {name: string | null; next: string | null; percent: number | null}
export function normalizeRelationshipLevels(raw: unknown): RelationshipLevel[] {
  if (!Array.isArray(raw)) throw new Error('关系等级必须是数组。');
  const levels: RelationshipLevel[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('每个等级须包含name和from。');
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > 40 || typeof value.from !== 'number' || !Number.isSafeInteger(value.from) || value.from < 0) throw new Error('等级名称须为1至40字，起点须为非负整数。');
    if (levels.some(level => level.name === name) || levels.length && value.from <= levels[levels.length - 1].from) throw new Error('等级名称不能重复，起点必须严格递增。');
    levels.push({name, from: value.from});
  }
  return levels;
}
export function relationshipMeter(value: number, levels: RelationshipLevel[]): RelationshipMeter {
  let index = -1;
  for (let i = 0; i < levels.length; i++) if (value >= levels[i].from) index = i;
  if (index < 0) return {name: null, next: levels[0]?.name ?? null, percent: levels.length ? 0 : null};
  const current = levels[index], next = levels[index + 1];
  return {name: current.name, next: next?.name ?? null, percent: next ? Math.max(0, Math.min(100, (value - current.from) / (next.from - current.from) * 100)) : 100};
}
