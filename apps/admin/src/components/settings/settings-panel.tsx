'use client';

import {CheckCircle2, History as HistoryIcon, Search, Settings} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {AdminNotice, AdminPanel} from '@admin/components/admin-page';
import {SettingsGroup} from '@admin/components/layout/settings-group';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';
import {SETTING_GROUPS, definitionsOfGroup} from '@rumiai/contracts/settings/registry';
import {SETTINGS_CACHE_TTL_MS} from '@rumiai/contracts/settings/types';
import type {SettingDefinition, SettingGroup as SettingsGroupId} from '@rumiai/contracts/settings/types';
import {ExportImportDialog} from './export-import-dialog';
import {sameSettingValue} from './format';
import {PromptPreview} from './prompt-preview';
import {RestoreDefaultsDialog} from './restore-defaults-dialog';
import {sectionsOfGroup} from './sections';
import {SettingField} from './setting-field';
import {SettingsHistoryDialog} from './settings-history-dialog';
import type {useSettingsGroup} from './use-settings-group';

/**
 * 当前分类的编辑面板：搜索、小节、字段行，以及三个弹窗（历史、导入导出、恢复默认）。
 *
 * 从设置中心拆出来是为了让外壳（权限闸门、分类标签、保存栏）保持单薄：
 * 外壳只管「能不能进、在哪个分类、要不要保存」，面板只管「这一页有哪些字段、怎么编辑」。
 */
const GROUP_HINTS: Record<SettingsGroupId, string> = {
  chat: '聊天输入与历史、发送频率、社区内容长度；改完下次请求即生效。',
  billing: '收费开关、免费额度与价格口径；开启前请先在「价格与成本」登记模型币价。',
  growth: '注册赠币、他眼中的你、评理广场、聊天记忆与后台任务。',
  accounts: '注册密码强度与登录会话有效期。',
  prompts: '他眼中的你、评理结案与记忆摘要的提示词模板。',
};

/** 高级项超过常用项时，常用区只展示前 N 个，其余一起进折叠区。 */
const MAX_COMMON_FIELDS = 10;

function searchableText(definition: SettingDefinition): string {
  return [definition.label, definition.key, definition.description].join(' ').toLowerCase();
}

export function SettingsPanel({activeGroup, sessionActive, canWrite, controller}: {
  activeGroup: SettingsGroupId;
  sessionActive: boolean;
  canWrite: boolean;
  controller: ReturnType<typeof useSettingsGroup>;
}) {
  const {definitions, values, draft, dirtyKeys, fieldErrors, loading, loadError, savedAt} = controller;
  const [query, setQuery] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [restoreScope, setRestoreScope] = useState<{label: string; items: SettingDefinition[]} | null>(null);

  const activeLabel = SETTING_GROUPS.find(group => group.id === activeGroup)?.label ?? '';
  const sections = useMemo(() => sectionsOfGroup(activeGroup), [activeGroup]);
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const matched = useMemo(
    () => (needle ? definitions.filter(definition => searchableText(definition).includes(needle)) : null),
    [definitions, needle],
  );

  useEffect(() => {
    setQuery('');
    setSavedNotice('');
  }, [activeGroup]);

  useEffect(() => {
    if (savedAt === null) return;
    // V3 表 10「如何生效」：本进程立即生效，其他后台进程最多一个缓存周期后刷新，界面照实说。
    const seconds = Math.round(SETTINGS_CACHE_TTL_MS / 1000);
    setSavedNotice(`已保存 ${activeGroup === 'prompts' ? '提示词' : '本页'}设置，当前进程立即生效；其他后台进程最多 ${seconds} 秒内跟进。`);
    const timer = window.setTimeout(() => setSavedNotice(''), 6000);
    return () => window.clearTimeout(timer);
  }, [savedAt, activeGroup]);

  function openRestore(scope: SettingDefinition[] | 'group', label: string) {
    setRestoreScope({label, items: scope === 'group' ? definitions : scope});
  }

  /** 恢复默认的影响预览：按「当前草稿值 → 默认值」列出会被改动的字段。只写草稿，不提交。 */
  const restoreItems = useMemo(() => {
    if (!restoreScope) return [];
    return restoreScope.items
      .filter(definition => !sameSettingValue(draft[definition.key] ?? null, definition.default))
      .map(definition => ({definition, current: draft[definition.key] ?? null}));
  }, [restoreScope, draft]);

  /** 一行设置；提示词额外带「试生成」，读的是已保存的模板。 */
  function renderField(definition: SettingDefinition) {
    return (
      <div key={definition.key}>
        <SettingField
          definition={definition}
          value={draft[definition.key] ?? definition.default}
          source={values[definition.key]?.source ?? 'DEFAULT'}
          version={values[definition.key]?.version ?? 0}
          updatedAt={values[definition.key]?.updatedAt ?? null}
          dirty={dirtyKeys.includes(definition.key)}
          error={fieldErrors[definition.key]}
          disabled={!canWrite}
          onChange={value => controller.setValue(definition.key, value)}
          onResetToDefault={() => openRestore([definition], definition.label)}
          userOverride={values[definition.key]?.source === 'USER'}
        />
        {activeGroup === 'prompts' && definition.type === 'text' && sessionActive && (
          <PromptPreview definition={definition} sessionActive={sessionActive} saved={String(values[definition.key]?.value ?? definition.default ?? '')} />
        )}
      </div>
    );
  }

  return (
    <div
      id="settings-panel"
      role="tabpanel"
      aria-label={`${activeLabel}设置`}
      aria-labelledby={`settings-tab-${activeGroup}`}
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{activeLabel}</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{GROUP_HINTS[activeGroup]}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative w-full min-w-0 sm:w-64 sm:flex-none">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="在本分类中搜索" aria-label="在本分类中搜索设置" className="pl-9" />
          </div>
          <Button variant="ghost" onClick={() => setHistoryOpen(true)} disabled={!sessionActive} leadingIcon={<HistoryIcon aria-hidden className="h-4 w-4" />}>
            修改历史
          </Button>
          {canWrite && (
            <Button variant="outline" onClick={() => openRestore('group', activeLabel)} disabled={loading || Boolean(loadError)}>
              恢复本类默认值
            </Button>
          )}
        </div>
      </div>

      {savedNotice && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-foreground">
          <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-600" />
          {savedNotice}
        </div>
      )}

      {loading && <AdminNotice tone="loading" title="正在读取设置…" />}

      {!loading && loadError && (
        <AdminNotice tone="error" title={loadError} action={<Button variant="outline" onClick={controller.reload}>重新读取</Button>} />
      )}

      {!loading && !loadError && !canWrite && (
        <AdminNotice tone="info" title="当前为只读查看" description="修改设置需要「保存运营设置」权限。" />
      )}

      {!loading && !loadError && searching && (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <header className="border-b border-border bg-muted/40 px-4 py-3 md:px-5">
            <h3 className="text-sm font-semibold text-foreground">搜索结果：{activeLabel}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">共 {matched?.length ?? 0} 项，包含默认折叠的高级项。</p>
          </header>
          {matched && matched.length > 0 ? (
            <div className="divide-y divide-border px-4 md:px-5">{matched.map(renderField)}</div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground md:px-5">没有匹配「{query.trim()}」的设置项。</p>
          )}
        </section>
      )}

      {!loading && !loadError && !searching && sections.length === 0 && (
        <AdminPanel title={activeLabel}>
          <p className="text-sm text-muted-foreground">这个分类下还没有可配置的项目。</p>
        </AdminPanel>
      )}

      {!loading && !loadError && !searching && sections.map(section => {
        const common = section.definitions.filter(definition => !definition.advanced);
        const advanced = section.definitions.filter(definition => definition.advanced);
        const visibleCommon = common.slice(0, MAX_COMMON_FIELDS);
        const allAdvanced = [...common.slice(MAX_COMMON_FIELDS), ...advanced];

        return (
          <SettingsGroup
            key={section.id}
            title={section.title}
            description={section.description}
            badge={<Badge variant="outline">{section.definitions.length} 项</Badge>}
            advancedCount={allAdvanced.length}
            advanced={allAdvanced.length > 0 ? allAdvanced.map(renderField) : undefined}
          >
            {visibleCommon.length > 0 ? visibleCommon.map(renderField) : (
              <p className="py-4 text-sm text-muted-foreground">本节只有高级项，展开下方「高级设置」修改。</p>
            )}
          </SettingsGroup>
        );
      })}

      {historyOpen && sessionActive && (
        <SettingsHistoryDialog
          open
          sessionActive={sessionActive}
          group={activeGroup}
          canWrite={canWrite}
          // 历史按分类取全量键（含 hidden 的），否则那几项的修改记录在筛选里选不到。
          definitions={definitionsOfGroup(activeGroup).map(definition => ({key: definition.key, label: definition.label}))}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => controller.reload()}
        />
      )}

      {transferOpen && sessionActive && (
        <ExportImportDialog open sessionActive={sessionActive} canWrite={canWrite} onClose={() => setTransferOpen(false)} onImported={() => controller.reload()} />
      )}

      {restoreScope && (
        <RestoreDefaultsDialog
          open
          scopeLabel={restoreScope.label}
          items={restoreItems}
          onCancel={() => setRestoreScope(null)}
          onConfirm={() => {
            for (const {definition} of restoreItems) controller.setValue(definition.key, definition.default);
            setRestoreScope(null);
          }}
        />
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Settings aria-hidden className="h-3.5 w-3.5" />
        字段技术名、默认值、可输入范围、来源、版本与更新时间在每项的「字段详情」里；同一项只在这里改一处。
      </p>
    </div>
  );
}
