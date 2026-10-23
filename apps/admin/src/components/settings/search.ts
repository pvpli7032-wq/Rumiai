import {definitionsOfGroup} from '@rumiai/contracts/settings/registry';
import type {SettingGroup} from '@rumiai/contracts/settings/types';
import {sectionForKey} from './sections';

export interface SettingSearchItem {
  group: {id: SettingGroup; label: string};
  definition: ReturnType<typeof definitionsOfGroup>[number];
  section: ReturnType<typeof sectionForKey>;
  specialHref?: string;
}

export function buildSettingSearchIndex(groups: Array<{id: SettingGroup; label: string}>, canReadAiCosts: boolean): SettingSearchItem[] {
  return groups.flatMap(group => definitionsOfGroup(group.id).map(definition => ({
    group,
    definition,
    section: sectionForKey(group.id, definition.key),
    specialHref: definition.hidden ? '/admin/ai/costs' : undefined,
  }))).filter(item => !item.definition.hidden || canReadAiCosts);
}

export function searchSettings(index: SettingSearchItem[], query: string): SettingSearchItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return index.filter(item => [item.definition.label, item.definition.key, item.definition.description, item.group.label].join(' ').toLowerCase().includes(needle));
}

/** 同类小节定位不应打断草稿；跨分类或跳出设置中心才需要一次确认。 */
export function shouldConfirmSettingNavigation(dirty: boolean, fromGroup: SettingGroup, toGroup: SettingGroup, specialHref?: string): boolean {
  return dirty && (fromGroup !== toGroup || Boolean(specialHref));
}
