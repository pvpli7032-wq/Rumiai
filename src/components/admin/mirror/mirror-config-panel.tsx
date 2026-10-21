'use client';

import {ArrowUpRight, Sparkles} from 'lucide-react';
import Link from 'next/link';
import type {ReactNode} from 'react';
import {AdminNotice, AdminPanel, AdminPanelGroup} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import type {MirrorConfigPayload} from './types';

/**
 * 配置标签：只读展示当前生效的角色、题目与版式，并给出去哪儿改。
 *
 * V3 §16 要求同一项只有一个编辑位置：题目数量、字数上限、保留天数都在设置中心，
 * 角色候选来自角色管理里的「专属 + 公开」。这里再放一套输入框就会两边打架。
 */
export interface MirrorConfigPanelProps {
  config: MirrorConfigPayload | null;
  error: string;
  loading: boolean;
}

/** 后台里「跳去别处改」的统一外形，和 Button 的 outline 尺寸对齐。 */
function JumpLink({href, children}: {href: string; children: ReactNode}) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
    </Link>
  );
}

function RuleRow({label, value, hint}: {label: string; value: string; hint?: string}) {
  return (
    <div className="flex flex-col gap-0.5 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-4">
      <span className="shrink-0 text-muted-foreground sm:w-36">{label}</span>
      <span className="min-w-0 break-words font-medium text-foreground">{value}</span>
      {hint && <span className="min-w-0 break-words text-xs text-muted-foreground sm:ml-auto">{hint}</span>}
    </div>
  );
}

export function MirrorConfigPanel({config, error, loading}: MirrorConfigPanelProps) {
  if (error) return <AdminNotice tone="error" title={error} description="配置来自公开初始化接口，读取失败时不影响结果列表。" />;
  if (loading || !config) return <AdminNotice tone="loading" title="正在读取当前配置…" />;

  const {characters, rules} = config;

  return (
    <AdminPanelGroup>
      <AdminPanel
        title="角色"
        description="公开且标记为「专属」的角色优先进入候选，不足时按聊天数补齐；角色本身在角色管理里编辑。"
        badge={<Badge variant={rules.enabled ? 'success' : 'warning'}>{rules.enabled ? '玩法已开启' : '玩法已关闭'}</Badge>}
        actions={<JumpLink href="/admin/characters">去角色管理</JumpLink>}
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">当前候选 {characters.length} 个；候选为空时前台会提示暂不可用。</p>
          {characters.length === 0 ? (
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">当前没有可用的公开角色。</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {characters.map(character => (
                <li key={character.id} className="min-w-0 rounded-lg border border-border p-3">
                  <p className="break-words text-sm font-medium">{character.name}</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{character.tagline ?? '没有设定一句话简介'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AdminPanel>

      <AdminPanel
        title="题目"
        description="题目数量与每题字数上限决定前台要回答几道题；修改在设置中心「增长玩法」。"
        actions={<JumpLink href="/admin/settings">去设置中心</JumpLink>}
      >
        <div className="divide-y divide-border">
          <RuleRow label="题目数量" value={`${rules.questionCount} 题`} hint="mirror.questionCount" />
          <RuleRow label="每题字数上限" value={`${rules.answerMaxChars} 字`} hint="mirror.answerMaxChars" />
        </div>
      </AdminPanel>

      <AdminPanel
        title="版式与保留"
        description="结果页的四段式版式（称号、三条观察、金句、两个娱乐指数）由前台组件决定；字数上限与保留天数在设置中心调整。"
        actions={<JumpLink href="/admin/settings">去设置中心</JumpLink>}
      >
        <div className="divide-y divide-border">
          <RuleRow label="称号字数" value={`${rules.titleMaxChars} 字`} hint="mirror.titleMaxChars" />
          <RuleRow label="每条观察字数" value={`${rules.observationMaxChars} 字`} hint="mirror.observationMaxChars" />
          <RuleRow label="金句字数" value={`${rules.quoteMaxChars} 字`} hint="mirror.quoteMaxChars" />
          <RuleRow label="对比角色数量" value={`${rules.compareLimit} 个`} hint="mirror.compareLimit" />
          <RuleRow label="结果保留天数" value={`${rules.resultRetentionDays} 天`} hint="mirror.resultRetentionDays，只影响新结果" />
          <RuleRow label="额度时区" value={rules.timezone} hint="billing.dayTimezone" />
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          提示词模板在设置中心「提示词」分类，与本页的版式参数分开保存。
        </p>
      </AdminPanel>
    </AdminPanelGroup>
  );
}
