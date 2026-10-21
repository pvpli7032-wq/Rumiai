'use client';

import Link from 'next/link';
import {ArrowDownUp} from 'lucide-react';
import {useState} from 'react';
import {AdminNotice, AdminPage} from '@/components/admin/admin-page';
import {AdminPageHeader} from '@/components/admin/layout/admin-page-header';
import {SaveBar} from '@/components/admin/layout/save-bar';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {cn} from '@/components/ui/cn';
import {SETTING_GROUPS} from '@/lib/settings/registry';
import type {SettingDefinition, SettingGroup as SettingsGroupId} from '@/lib/settings/types';
import {ExportImportDialog} from './export-import-dialog';
import {SettingsPanel} from './settings-panel';
import {useSettingsGroup} from './use-settings-group';
import {useUnsavedGuard} from './use-unsaved-guard';

/**
 * 设置中心：单内容区 + 顶部分类标签（V3 §16）。
 *
 * 一次只读、一次只存一个分类；分类先列常用项，高级项折叠；有改动时才出现底部
 * 保存栏，离开前提醒一次。技术键与默认值收在字段详情里，不占每行版面。
 * 本文件只负责外壳：权限闸门、分类标签、导出导入入口与保存栏；
 * 字段与小节在 settings-panel.tsx。
 */
export function SettingsCenter() {
  const {token, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const [activeGroup, setActiveGroup] = useState<SettingsGroupId>('chat');
  const [transferOpen, setTransferOpen] = useState(false);

  const canRead = permissions.includes('settings.read');
  const canWrite = permissions.includes('settings.write');
  const controller = useSettingsGroup(token ?? undefined, activeGroup, Boolean(token && canRead));
  const {definitions, dirtyKeys, loading, loadError, saving, saveError} = controller;

  useUnsavedGuard(dirtyKeys.length > 0);

  // 分类标签是「切换视图」而不是离开页面：分类之间切换时先确认一次，避免悄悄丢掉草稿。
  function switchGroup(next: SettingsGroupId) {
    if (next === activeGroup) return;
    if (dirtyKeys.length > 0 && !window.confirm('当前分类有未保存的修改，切换分类会放弃这些修改，继续吗？')) return;
    setActiveGroup(next);
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
        actions={
          <>
            <Badge variant={canWrite ? 'brand' : 'neutral'}>{canWrite ? '可编辑' : '只读'}</Badge>
            <Button variant="outline" onClick={() => setTransferOpen(true)} leadingIcon={<ArrowDownUp aria-hidden className="h-4 w-4" />}>
              导出 / 导入
            </Button>
          </>
        }
      />

      {tabs}

      <SettingsPanel activeGroup={activeGroup} token={token} canWrite={canWrite} controller={controller} />

      {transferOpen && (
        <ExportImportDialog open token={token} canWrite={canWrite} onClose={() => setTransferOpen(false)} onImported={() => controller.reload()} />
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
