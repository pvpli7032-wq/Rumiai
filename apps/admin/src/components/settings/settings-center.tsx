'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {ArrowDownUp, Search} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {AdminNotice, AdminPage} from '@admin/components/admin-page';
import {AdminPageHeader} from '@admin/components/layout/admin-page-header';
import {SaveBar} from '@admin/components/layout/save-bar';
import {useAdminAccess} from '@admin/components/use-admin-access';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {cn} from '@rumiai/ui/cn';
import {SETTING_GROUPS} from '@rumiai/contracts/settings/registry';
import type {SettingDefinition, SettingGroup as SettingsGroupId} from '@rumiai/contracts/settings/types';
import {ExportImportDialog} from './export-import-dialog';
import {SettingsPanel} from './settings-panel';
import {useSettingsGroup} from './use-settings-group';
import {useUnsavedGuard} from './use-unsaved-guard';
import {buildSettingSearchIndex, searchSettings} from './search';
import {sectionsOfGroup} from './sections';

function settingsGroup(value: string | null): SettingsGroupId {
  return SETTING_GROUPS.some(group => group.id === value) ? value as SettingsGroupId : 'chat';
}

function settingsHref(group: SettingsGroupId, section?: string): string {
  const params = new URLSearchParams();
  if (group !== 'chat') params.set('tab', group);
  const targetSection = section ?? sectionsOfGroup(group)[0]?.id;
  if (targetSection) params.set('section', targetSection);
  return params.size ? `/admin/settings?${params}` : '/admin/settings';
}

/**
 * 设置中心：单内容区 + 顶部分类标签（V3 §16）。
 *
 * 一次只读、一次只存一个分类；分类先列常用项，高级项折叠；有改动时才出现底部
 * 保存栏，离开前提醒一次。技术键与默认值收在字段详情里，不占每行版面。
 * 本文件只负责外壳：权限闸门、分类标签、导出导入入口与保存栏；
 * 字段与小节在 settings-panel.tsx。
 */
export function SettingsCenter() {
  const {sessionActive, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const requestedSection = searchParams.get('section') ?? undefined;
  const urlGroup = settingsGroup(requestedTab);
  const urlSection = requestedSection && sectionsOfGroup(urlGroup).some(section => section.id === requestedSection) ? requestedSection : undefined;
  const [activeGroup, setActiveGroup] = useState<SettingsGroupId>(urlGroup);
  const [sectionId, setSectionId] = useState<string | undefined>(urlSection);
  const [globalQuery, setGlobalQuery] = useState('');
  const [focus, setFocus] = useState<{key: string; nonce: number} | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const canRead = permissions.includes('settings.read');
  const canWrite = permissions.includes('settings.write');
  const controller = useSettingsGroup(sessionActive ?? undefined, activeGroup, Boolean(sessionActive && canRead));
  const {definitions, dirtyKeys, loading, loadError, saving, saveError} = controller;

  const applyNavigation = useCallback((href: string) => {
    const target = new URL(href, window.location.origin);
    if (target.pathname !== '/admin/settings') return;
    const group = settingsGroup(target.searchParams.get('tab'));
    const requested = target.searchParams.get('section') ?? undefined;
    const section = requested && sectionsOfGroup(group).some(item => item.id === requested) ? requested : undefined;
    setActiveGroup(group);
    setSectionId(section);
  }, []);

  const shouldConfirmNavigation = useCallback((from: URL, to: URL) => {
    if (to.pathname !== '/admin/settings') return true;
    return settingsGroup(from.searchParams.get('tab')) !== settingsGroup(to.searchParams.get('tab'));
  }, []);

  const guardedNavigate = useUnsavedGuard(dirtyKeys.length > 0, {
    location: settingsHref(activeGroup, sectionId),
    shouldConfirm: shouldConfirmNavigation,
    onNavigate: applyNavigation,
  });

  useEffect(() => {
    const invalid = (requestedTab !== null && requestedTab !== urlGroup) || (requestedSection !== undefined && requestedSection !== urlSection);
    if (dirtyKeys.length === 0 && (activeGroup !== urlGroup || sectionId !== urlSection)) {
      setActiveGroup(urlGroup);
      setSectionId(urlSection);
    }
    if (invalid) router.replace(settingsHref(urlGroup, urlSection), {scroll: false});
  }, [activeGroup, dirtyKeys.length, requestedSection, requestedTab, router, sectionId, urlGroup, urlSection]);

  // 分类标签是「切换视图」而不是离开页面：分类之间切换时先确认一次，避免悄悄丢掉草稿。
  const switchGroup = useCallback((next: SettingsGroupId) => {
    if (next === activeGroup) return;
    guardedNavigate(settingsHref(next));
  }, [activeGroup, guardedNavigate]);

  const switchSection = useCallback((next: string, history: 'push' | 'replace' = 'push') => {
    guardedNavigate(settingsHref(activeGroup, next), {replace: history === 'replace'});
  }, [activeGroup, guardedNavigate]);

  const searchIndex = useMemo(() => buildSettingSearchIndex(SETTING_GROUPS, permissions.includes('ai.costs.read')), [permissions]);
  const searchMatches = useMemo(() => searchSettings(searchIndex, globalQuery), [globalQuery, searchIndex]);
  const searchResults = searchMatches.slice(0, 20);

  function openSearchResult(item: typeof searchIndex[number]) {
    if (item.specialHref) {
      if (guardedNavigate(item.specialHref)) setGlobalQuery('');
      return;
    }
    if (!guardedNavigate(settingsHref(item.group.id, item.section?.id))) return;
    setGlobalQuery('');
    setFocus({key: item.definition.key, nonce: Date.now()});
  }

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
  if (!sessionActive) {
    return (
      <AdminPage width="narrow">
        <AdminPageHeader eyebrow="系统设置" title="设置中心" />
        <AdminNotice
          tone="warning"
          title="请先登录管理员账号"
          description="设置中心只对拥有管理身份的账号开放。"
          action={<Link href="/admin/login?next=%2Fadmin%2Fsettings"><Button>前往登录</Button></Link>}
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
        actions={
          <>
            <Badge variant={canWrite ? 'brand' : 'neutral'}>{canWrite ? '可编辑' : '只读'}</Badge>
            <Button variant="outline" onClick={() => setTransferOpen(true)} leadingIcon={<ArrowDownUp aria-hidden className="h-4 w-4" />}>
              导出 / 导入
            </Button>
          </>
        }
      />

      <div className="rounded-xl border border-border bg-card p-1.5 shadow-sm">
        {tabs}
      </div>

      <div className="relative z-10 rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={globalQuery} onChange={event => setGlobalQuery(event.target.value)} placeholder="搜索全部设置：名称、技术键或说明" aria-label="搜索全部设置" className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20" />
        </div>
        {globalQuery.trim() && <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-background p-1" role="listbox" aria-label="全局设置搜索结果">
          {searchResults.length ? <>
            <p className="px-3 py-2 text-xs text-muted-foreground">共 {searchMatches.length} 项{searchMatches.length > 20 ? '，显示前 20 项' : ''}</p>
            {searchResults.map(item => <button key={`${item.group.id}:${item.definition.key}`} type="button" role="option" onClick={() => openSearchResult(item)} className="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-muted">
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{item.definition.label}</span><span className="block truncate text-xs text-muted-foreground">{item.definition.key} · {item.group.label}{item.section ? ` · ${item.section.title}` : ' · 专属页面'}</span></span>
          </button>)}</> : <p className="px-3 py-4 text-center text-sm text-muted-foreground">没有匹配的设置项。</p>}
        </div>}
        <p className="mt-2 text-xs text-muted-foreground">跨分类搜索只展示当前账号可见的登记项；AI 模型路由等专属项仅提供跳转，不读取参数值。</p>
      </div>

      <SettingsPanel activeGroup={activeGroup} sessionActive={sessionActive} canWrite={canWrite} controller={controller} sectionId={sectionId} onSectionChange={switchSection} focus={focus} />

      {transferOpen && (
        <ExportImportDialog open sessionActive={sessionActive} canWrite={canWrite} onClose={() => setTransferOpen(false)} onImported={() => controller.reload()} />
      )}

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
