'use client';

import Link from 'next/link';
import {CheckCircle2, History as HistoryIcon, Search, Settings} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {AdminNotice, AdminPage, AdminPanel} from '@/components/admin/admin-page';
import {AdminPageHeader} from '@/components/admin/layout/admin-page-header';
import {SaveBar} from '@/components/admin/layout/save-bar';
import {SettingsGroup} from '@/components/admin/layout/settings-group';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cn} from '@/components/ui/cn';
import {SETTING_GROUPS} from '@/lib/settings/registry';
import type {SettingDefinition, SettingGroup as SettingsGroupId} from '@/lib/settings/types';
import {RestoreDefaultsDialog} from './restore-defaults-dialog';
import {SettingsHistoryDialog} from './settings-history-dialog';
import {sameSettingValue} from './format';
import {sectionsOfGroup} from './sections';
import {SettingField} from './setting-field';
import {useSettingsGroup} from './use-settings-group';
import {useUnsavedGuard} from './use-unsaved-guard';

/**
 * 设置中心：单内容区 + 顶部分类标签（V3 §16）。
 *
 * 一次只读、一次只存一个分类；分类先列常用项，高级项折叠；有改动时才出现底部
 * 保存栏，离开前提醒一次。技术键与默认值收在字段详情里，不占每行版面。
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

export function SettingsCenter() {
  const {token, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const [activeGroup, setActiveGroup] = useState<SettingsGroupId>('chat');
  const [query, setQuery] = useState('');
  const [restoreScope, setRestoreScope] = useState<{label: string; items: SettingDefinition[]} | null>(null);
  const [savedNotice, setSavedNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const canRead = permissions.includes('settings.read');
  const canWrite = permissions.includes('settings.write');
  const controller = useSettingsGroup(token ?? undefined, activeGroup, Boolean(token && canRead));
  const {definitions, values, draft, dirtyKeys, fieldErrors, loading, loadError, saving, saveError, savedAt} = controller;

  useUnsavedGuard(dirtyKeys.length > 0);

  // 分类标签是「切换视图」而不是离开页面：分类之间切换时先确认一次，避免悄悄丢掉草稿。
  function switchGroup(next: SettingsGroupId) {
    if (next === activeGroup) return;
    if (dirtyKeys.length > 0 && !window.confirm('当前分类有未保存的修改，切换分类会放弃这些修改，继续吗？')) return;
    setActiveGroup(next);
  }

  useEffect(() => {
    setQuery('');
    setSavedNotice('');
  }, [activeGroup]);

  useEffect(() => {
    if (savedAt === null) return;
    setSavedNotice(`已保存 ${activeGroup === 'prompts' ? '提示词' : '本页'}设置，页面保持在当前位置。`);
    const timer = window.setTimeout(() => setSavedNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [savedAt, activeGroup]);

  const sections = useMemo(() => sectionsOfGroup(activeGroup), [activeGroup]);
  const searching = query.trim().length > 0;
  const needle = query.trim().toLowerCase();

  const matched = useMemo(() => {
    if (!needle) return null;
    return definitions.filter(definition => searchableText(definition).includes(needle));
  }, [definitions, needle]);

  function openRestore(scope: SettingDefinition[] | 'group', label: string) {
    setRestoreScope({
      label,
      items: scope === 'group' ? definitions : scope,
    });
  }

  /**
   * 恢复默认的影响预览：按「当前草稿值 → 默认值」列出会被改动的字段。
   * 只写草稿，不提交；提交仍走底部保存栏。
   */
  const restoreItems = useMemo(() => {
    if (!restoreScope) return [];
    return restoreScope.items
      .filter(definition => !sameSettingValue(draft[definition.key] ?? null, definition.default))
      .map(definition => ({definition, current: draft[definition.key] ?? null}));
  }, [restoreScope, draft]);

  const activeLabel = SETTING_GROUPS.find(group => group.id === activeGroup)?.label ?? '';

  const tabs = (
    <div
      role="tablist"
      aria-label="设置分类"
      className="flex min-w-0 snap-x items-center gap-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] md:flex-wrap [&::-webkit-scrollbar]:hidden"
    >
      {SETTING_GROUPS.map(group => {
        const selected = group.id === activeGroup;
        return (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={selected}
            id={`settings-tab-${group.id}`}
            aria-controls="settings-panel"
            onClick={() => switchGroup(group.id)}
            className={cn(
              'min-h-10 shrink-0 snap-start rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {group.label}
          </button>
        );
      })}
    </div>
  );

  if (accessLoading) {
    return (
      <AdminPage width="default">
        <AdminNotice tone="loading" title="正在读取管理权限…" />
      </AdminPage>
    );
  }
  if (!token) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="系统设置" title="设置中心" />
        <AdminNotice
          tone="warning"
          title="请先登录管理员账号"
          description="设置中心只对拥有管理身份的账号开放。"
          action={<Link href="/login?next=%2Fadmin%2Fsettings"><Button>前往登录</Button></Link>}
        />
      </AdminPage>
    );
  }
  if (accessError) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="系统设置" title="设置中心" />
        <AdminNotice tone="error" title={accessError} />
      </AdminPage>
    );
  }
  if (!canRead) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="系统设置" title="设置中心" />
        <AdminNotice
          tone="denied"
          title="当前账号没有查看设置的权限"
          description="需要「查看运营设置与修改历史」权限；请联系站点负责人分配。"
          action={<Link href="/admin"><Button variant="outline">返回工作台</Button></Link>}
        />
      </AdminPage>
    );
  }

  return (
    <AdminPage width="default">
      <AdminPageHeader
        eyebrow="系统设置"
        title="设置中心"
        description="运营参数统一在这里修改：按分类选择，改完点底部「保存本页」立即生效；一般设置不需要填写理由。"
        actions={<Badge variant={canWrite ? 'brand' : 'neutral'}>{canWrite ? '可编辑' : '只读'}</Badge>}
      />

      {tabs}

      <div
        id="settings-panel"
        role="tabpanel"
        aria-label={`${activeLabel}设置`}
        aria-labelledby={`settings-tab-${activeGroup}`}
        className="flex min-w-0 flex-col gap-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{activeLabel}</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{GROUP_HINTS[activeGroup]}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="在本分类中搜索"
                aria-label="在本分类中搜索设置"
                className="pl-9"
              />
            </div>
            <Button variant="ghost" onClick={() => setHistoryOpen(true)} disabled={!token} leadingIcon={<HistoryIcon aria-hidden className="h-4 w-4" />}>
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
          <AdminNotice
            tone="error"
            title={loadError}
            action={<Button variant="outline" onClick={controller.reload}>重新读取</Button>}
          />
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
              <div className="divide-y divide-border px-4 md:px-5">
                {matched.map(definition => (
                  <SettingField
                    key={definition.key}
                    definition={definition}
                    value={draft[definition.key] ?? definition.default}
                    source={values[definition.key]?.source ?? 'DEFAULT'}
                    version={values[definition.key]?.version ?? 0}
                    dirty={dirtyKeys.includes(definition.key)}
                    error={fieldErrors[definition.key]}
                    disabled={!canWrite}
                    onChange={value => controller.setValue(definition.key, value)}
                    onResetToDefault={() => openRestore([definition], definition.label)}
                    userOverride={values[definition.key]?.source === 'USER'}
                  />
                ))}
              </div>
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
          const overflow = common.slice(MAX_COMMON_FIELDS);
          const allAdvanced = [...overflow, ...advanced];

          const renderField = (definition: SettingDefinition) => (
            <SettingField
              key={definition.key}
              definition={definition}
              value={draft[definition.key] ?? definition.default}
              source={values[definition.key]?.source ?? 'DEFAULT'}
              version={values[definition.key]?.version ?? 0}
              dirty={dirtyKeys.includes(definition.key)}
              error={fieldErrors[definition.key]}
              disabled={!canWrite}
              onChange={value => controller.setValue(definition.key, value)}
              onResetToDefault={() => openRestore([definition], definition.label)}
              userOverride={values[definition.key]?.source === 'USER'}
            />
          );

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

        {historyOpen && token && (
          <SettingsHistoryDialog
            open
            token={token}
            group={activeGroup}
            canWrite={canWrite}
            definitions={definitions.map(definition => ({key: definition.key, label: definition.label}))}
            onClose={() => setHistoryOpen(false)}
            onRestored={() => controller.reload()}
          />
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
          字段技术名、默认值、来源与版本在每项的「字段详情」里；同一项只在这里改一处。
        </p>
      </div>

      <SaveBar
        visible={canWrite && !loading && !loadError && dirtyKeys.length > 0}
        dirtyCount={dirtyKeys.length}
        saving={saving}
        error={saveError || undefined}
        hint={saveHint(dirtyKeys, definitions)}
        onDiscard={() => controller.discard()}
        onSave={() => { void controller.save(); }}
      />
    </AdminPage>
  );
}

/** 保存栏里点名将被保存的字段，避免「保存本页」在长长一页里说不清。 */
function saveHint(keys: string[], definitions: SettingDefinition[]): string {
  const labels = keys.slice(0, 3).map(key => definitions.find(definition => definition.key === key)?.label ?? key);
  return keys.length > 3 ? `将保存 ${labels.join('、')} 等 ${keys.length} 项。` : `将保存 ${labels.join('、')}。`;
}
