'use client';

import {ArrowUpRight, Sparkles} from 'lucide-react';
import Link from 'next/link';
import type {ReactNode} from 'react';
import {AdminNotice, AdminPanel, AdminPanelGroup} from '@admin/components/admin-page';
import {Badge} from '@rumiai/ui/badge';
import {MIRROR_LAYOUT_LABELS, MIRROR_SOURCE_LABELS, mirrorQuestionState, type MirrorConfigPayload} from './types';

/**
 * 配置标签：只读展示当前生效的推广角色、题目、示例结果与版式，并给出去哪儿改。
 *
 * V3 §16 要求同一项只有一个编辑位置：题目数量、字数上限、保留天数、题目文本与示例结果
 * 都在设置中心（mirror.questionCount / mirror.questions / mirror.exampleResults …），
 * 推广角色名单在 mirror.featuredCharacterIds。这里再放一套输入框就会两边打架，所以只展示 + 跳转。
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

  const {characters, rules, questions, examples, exampleCount} = config;
  const questionState = mirrorQuestionState(questions, rules.questionCount);
  // 示例按当前展示的角色统计覆盖率：配了但角色不在名单里的，前台不会展示。
  const covered = examples.length;
  const uncovered = Math.max(0, characters.length - covered);

  return (
    <AdminPanelGroup>
      <div className="grid gap-5 xl:grid-cols-2">
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
                <li key={character.id} className="min-w-0 rounded-2xl border border-border/80 bg-card p-3 shadow-sm">
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
        title="三道问题"
        description="题目文本本身也在这里只读展示：前台按「题目数量」顺序取前几条提问，不内置任何默认题。"
        badge={<Badge variant={questionState.ok ? 'success' : 'warning'}>{questionState.label}</Badge>}
        actions={<JumpLink href="/admin/settings">去设置中心</JumpLink>}
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{questionState.detail}（mirror.questions / mirror.questionCount）</p>
          {questions.length === 0 ? (
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">还没有配置题目文本，前台会提示待配置并暂停答题。</p>
          ) : (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
              {questions.map((question, index) => (
                <li key={index} className="break-words">{question}</li>
              ))}
            </ol>
          )}
        </div>
      </AdminPanel>

      <AdminPanel
        title="示例结果"
        description="运营为每个角色准备的示例，前台在角色还没有真实结果时展示，并明确标注「示例」。示例不落结果表，也不进任何统计。"
        badge={<Badge variant={exampleCount > 0 ? 'success' : 'warning'}>{exampleCount > 0 ? `已配 ${exampleCount} 条` : '待配置'}</Badge>}
        actions={<JumpLink href="/admin/settings">去设置中心</JumpLink>}
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-5 text-muted-foreground">
            配置项 mirror.exampleResults，形如
            {' '}
            <code className="break-all rounded bg-muted px-1 py-0.5 text-[11px]">[{'{'}characterId, title, observations: [三条], quote, indexA, indexB{'}'}]</code>
            ；字数上限与真实结果共用 mirror.titleMaxChars / observationMaxChars / quoteMaxChars，超长会截断，缺字段的那条直接忽略。
          </p>
          <div className="divide-y divide-border">
            <RuleRow label="已配置示例" value={`${exampleCount} 条`} hint="同一个角色配多条时只取第一条" />
            <RuleRow label="当前角色覆盖" value={`${covered}/${characters.length} 个`} hint={uncovered > 0 ? `还有 ${uncovered} 个角色没有示例，前台对它们不展示示例区` : '当前展示的角色都有示例'} />
          </div>
          {examples.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {examples.map(example => (
                <li key={example.characterId} className="min-w-0 rounded-2xl border border-border/80 bg-card p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="break-words text-sm font-medium">{example.title}</p>
                    <Badge variant="warning">示例</Badge>
                  </div>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {characters.find(item => item.id === example.characterId)?.name ?? example.characterId} · 氛围 {example.indices.atmosphere} / 默契 {example.indices.rapport}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AdminPanel>

      </div>

      <AdminPanel
        title="观察风格、版式与保留"
        description="观察风格直接拼进提示词；版式决定结果页怎么排，生成时写进结果，改它只影响新结果。两项都在设置中心编辑。"
        actions={<JumpLink href="/admin/settings">去设置中心</JumpLink>}
      >
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">三条观察的写法（mirror.observationStyle）</p>
          <p className="mt-1 break-words text-sm text-foreground">
            {rules.observationStyle || '未配置：提示词里不加风格要求，按内置的那一句写。'}
          </p>
        </div>
        <div className="divide-y divide-border">
          <RuleRow label="题目数量" value={`${rules.questionCount} 题`} hint="mirror.questionCount" />
          <RuleRow label="每题字数上限" value={`${rules.answerMaxChars} 字`} hint="mirror.answerMaxChars" />
          <RuleRow label="称号字数" value={`${rules.titleMaxChars} 字`} hint="mirror.titleMaxChars" />
          <RuleRow label="每条观察字数" value={`${rules.observationMaxChars} 字`} hint="mirror.observationMaxChars" />
          <RuleRow label="金句字数" value={`${rules.quoteMaxChars} 字`} hint="mirror.quoteMaxChars" />
          <RuleRow label="结果版式" value={MIRROR_LAYOUT_LABELS[rules.resultLayout]} hint="mirror.resultLayout，只影响新结果" />
          <RuleRow label="对比角色数量" value={`${rules.compareLimit} 个`} hint="mirror.compareLimit" />
          <RuleRow label="结果保留天数" value={`${rules.resultRetentionDays} 天`} hint="mirror.resultRetentionDays，只影响新结果" />
          <RuleRow label="额度时区" value={rules.timezone} hint="billing.dayTimezone" />
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          提示词模板在设置中心「提示词」分类；观察风格与版式在「增长与玩法」分类，与本页展示的这些参数一一对应。
        </p>
      </AdminPanel>
    </AdminPanelGroup>
  );
}
