'use client';

import {ArrowUpRight, Sparkles} from 'lucide-react';
import Link from 'next/link';
import type {ReactNode} from 'react';
import {AdminNotice, AdminPanel, AdminPanelGroup} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {MIRROR_SOURCE_LABELS, type MirrorConfigPayload} from './types';

/**
 * 配置标签：只读展示当前生效的推广角色、题目与版式，并给出去哪儿改。
 *
 * V3 §16 要求同一项只有一个编辑位置：题目数量、字数上限、保留天数都在设置中心，
 * 推广角色名单在设置中心 mirror.featuredCharacterIds（留空则按热度自动选取）。
 * 这里再放一套输入框就会两边打架，所以只展示 + 跳转。
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
        title="推广角色"
        description="首页展示的角色。名单在设置中心指定（按顺序取公开且已审核的角色）；名单为空或全部失效时，回退为「本站原创 + 聊得最多」自动选取。"
        badge={<Badge variant={rules.enabled ? 'success' : 'warning'}>{rules.enabled ? '玩法已开启' : '玩法已关闭'}</Badge>}
        actions={<JumpLink href="/admin/settings">修改相关设置</JumpLink>}
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            当前生效 {characters.length} 个；改名单用 mirror.featuredCharacterIds，角色资料在角色管理里编辑。
          </p>
          {characters.length === 0 ? (
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">当前没有可用的公开角色，前台会提示暂不可用。</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {characters.map(character => (
                <li key={character.id} className="min-w-0 rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="break-words text-sm font-medium">{character.name}</p>
                    <Badge variant={character.source === 'CONFIGURED' ? 'brand' : 'neutral'}>{MIRROR_SOURCE_LABELS[character.source]}</Badge>
                  </div>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{character.tagline ?? '没有设定一句话简介'}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            标记为「自动选取」说明当前名单为空，或名单里的角色都已下架 / 未通过审核。
          </p>
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
