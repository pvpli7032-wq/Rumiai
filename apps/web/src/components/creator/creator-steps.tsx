'use client';

import { Search, X } from 'lucide-react';
import { Checklist, Counter, Field, Toggle } from '@/components/creator/fields';
import { ImageUpload } from '@/components/creator/image-upload';
import { INPUT_CLS, SECTIONS, type Draft } from './creator-draft';

type Limits = ReturnType<typeof import('./creator-draft').limitsFromConfig>;

function Card({
  id, title, desc, children,
}: {
  id: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-32 space-y-5 rounded-[24px] border border-border bg-card p-5"
    >
      <header>
        <h2 id={`${id}-title`} tabIndex={-1} className="scroll-mt-32 text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </header>
      {children}
    </section>
  );
}

export interface CreatorStepsProps {
  active: string;
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  blur: (key: string) => void;
  toggleIn: (key: 'tags' | 'badges', value: string) => void;
  touched: Record<string, boolean>;
  errors: Record<string, string | null>;
  done: Record<string, boolean>;
  LIMITS: Limits;
  token: string | null;
  tagQuery: string;
  setTagQuery: (value: string) => void;
  filteredGroups: { label: string; tags: { key: string; label: string }[] }[];
  labelOf: (key: string) => string;
  badges: { emoji: string; label: string }[];
  uploadBusy: boolean;
  setUploadBusy: (busy: boolean) => void;
}

/** 五步表单各自的字段。每步的必填判断在 use-creator-form，这里只管字段与提示。 */
export function CreatorSteps(props: CreatorStepsProps) {
  const { active, draft, set, blur, toggleIn, touched, errors, done, LIMITS, token, tagQuery, setTagQuery, filteredGroups, labelOf, badges, setUploadBusy } = props;

  if (active === 'identity') {
    return (
      <Card id="identity" title={"身份"} desc={"读者开始聊天前看到的信息"}>
        <Field label={"角色名称"} required error={touched.name ? errors.name : null} hint={"显示在角色卡和聊天中"}>
          <input
            aria-label="角色名称"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            onBlur={() => blur('name')}
            maxLength={LIMITS.name}
            placeholder={"例如：林澈、星野、晴川"}
            className={INPUT_CLS}
          />
          <Counter value={draft.name.length} max={LIMITS.name} />
        </Field>

        <Field label={"一句话简介"} required error={touched.tagline ? errors.tagline : null} hint={"用一句话介绍角色的特点"}>
          <input
            aria-label="一句话简介"
            value={draft.tagline}
            onChange={(e) => set('tagline', e.target.value)}
            onBlur={() => blur('tagline')}
            maxLength={LIMITS.tagline}
            placeholder={"例如：“愿意陪你读完这个故事。”"}
            className={INPUT_CLS}
          />
          <Counter value={draft.tagline.length} max={LIMITS.tagline} />
        </Field>

        <Field label={"头像"} hint={"角色卡使用竖版头像"}>
          <ImageUpload value={draft.avatarUrl} onChange={(url) => set('avatarUrl', url)} token={token} onBusyChange={setUploadBusy} />
        </Field>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-secondary/50 px-3.5 py-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium leading-tight">{"本站原创角色"}</span>
            <span className="text-xs text-muted-foreground">{"在角色卡显示原创标记"}</span>
          </span>
          <Toggle checked={draft.isExclusive} onChange={(v) => set('isExclusive', v)} label={"本站原创"} />
        </label>
      </Card>
    );
  }

  if (active === 'persona') {
    return (
      <Card id="persona" title={"个性"} desc={"这部分会传给 AI 作为角色设定"}>
        <Field label={"个性与说话方式"} required error={touched.description ? errors.description : null}>
          <textarea
            aria-label="角色个性"
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            onBlur={() => blur('description')}
            maxLength={LIMITS.description}
            placeholder={"安静、真诚，善于倾听。自称“我”，称呼读者为“你”。"}
            className={`${INPUT_CLS} h-44 resize-y`}
          />
          <Counter value={draft.description.length} max={LIMITS.description} />
          <Checklist
            items={[
              { done: draft.description.trim().length >= 40, label: "至少 40 个字符，让 AI 理解角色特点" },
              { done: /['"‘“]/.test(draft.description) || draft.description.includes("称"), label: "说明角色的自称和对读者的称呼" },
              { done: draft.description.split(/[ ,\n]+/).filter(Boolean).length >= 8, label: "描述多个个性特点" },
            ]}
          />
        </Field>

        <Field label={"背景故事"} hint={"与读者的关系和故事的起点"}>
          <textarea
            aria-label="角色背景"
            value={draft.bio}
            onChange={(e) => set('bio', e.target.value)}
            maxLength={LIMITS.bio}
            placeholder={"图书馆值班管理员，喜欢文学和历史。读者每周五都会来借书。"}
            className={`${INPUT_CLS} h-40 resize-y`}
          />
          <Counter value={draft.bio.length} max={LIMITS.bio} />
        </Field>
      </Card>
    );
  }

  if (active === 'opening') {
    return (
      <Card id="opening" title={"开场"} desc={"开场白决定故事的起点"}>
        <Field label={"开场白"} hint={"用 *文字* 描述动作"}>
          <textarea
            aria-label="开场白"
            value={draft.greeting}
            onChange={(e) => set('greeting', e.target.value)}
            maxLength={LIMITS.greeting}
            placeholder={"*他把书轻轻放在桌上*\n\n“今天想读什么故事？”"}
            className={`${INPUT_CLS} h-48 resize-y`}
          />
          <Counter value={draft.greeting.length} max={LIMITS.greeting} />
          <Checklist
            items={[
              { done: draft.greeting.includes('*'), label: "用 *星号* 描述动作" },
              { done: /["“]/.test(draft.greeting), label: "用引号标记对话" },
              { done: draft.greeting.trim().length >= 30, label: "描述清晰的场景" },
            ]}
          />
        </Field>

        <Field label={"当前场景"} hint={"聊天开始时的场景，也会传给模型"}>
          <textarea
            aria-label="场景设定"
            value={draft.scenario}
            onChange={(e) => set('scenario', e.target.value)}
            maxLength={LIMITS.scenario}
            placeholder={"你刚走进图书馆，窗外开始下雨，他仍在整理书架。"}
            className={`${INPUT_CLS} h-28 resize-y`}
          />
          <Counter value={draft.scenario.length} max={LIMITS.scenario} />
        </Field>

        <Field label={"扮演方式"} hint={"说明模型如何扮演角色或叙述故事"}>
          <textarea
            aria-label="扮演方式"
            value={draft.roleTemplate}
            onChange={(e) => set('roleTemplate', e.target.value)}
            maxLength={LIMITS.roleTemplate}
            placeholder={"以图书馆管理员的身份回复，不替读者做决定。"}
            className={`${INPUT_CLS} h-24 resize-y`}
          />
          <Counter value={draft.roleTemplate.length} max={LIMITS.roleTemplate} />
        </Field>
      </Card>
    );
  }

  if (active === 'tags') {
    return (
      <Card id="tags" title={"标签"} desc={"已选择" + (draft.tags.length) + "标签"}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="搜索标签"
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder={"搜索标签…"}
            className={`${INPUT_CLS} pl-9`}
          />
        </div>

        {draft.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {draft.tags.map((t) => (
              <button
                key={t}
                onClick={() => toggleIn('tags', t)}
                className="flex min-h-11 items-center gap-1 rounded-full bg-brand px-3 text-sm font-semibold text-brand-foreground"
              >
                {labelOf(t)}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        {filteredGroups.map((g) => (
          <div key={g.label} className="space-y-2">
            <p className="text-sm font-bold text-muted-foreground">{g.label}</p>
            <div className="flex flex-wrap gap-2">
              {g.tags.map((t) => {
                const on = draft.tags.includes(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => toggleIn('tags', t.key)}
                    className={`flex min-h-11 items-center rounded-full px-3 text-sm font-semibold transition-all ${
                      on ? 'bg-brand-strong/15 text-brand-strong ring-1 ring-brand-strong/40' : 'border border-border hover:bg-accent'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filteredGroups.length === 0 && <p className="text-sm text-muted-foreground">{"没有找到匹配的标签：“"}{tagQuery}”</p>}
      </Card>
    );
  }

  return (
    <Card id="publish" title={"发布"} desc={"发布前检查信息"}>
      <div className="space-y-2">
        <p className="text-sm font-medium">{"角色卡特征"}</p>
        <div className="flex flex-wrap gap-2">
          {badges.map((b) => {
            const on = draft.badges.includes(b.emoji);
            return (
              <button
                key={b.emoji}
                onClick={() => toggleIn('badges', b.emoji)}
                className={`flex min-h-11 items-center gap-2 rounded-full px-3 text-sm transition-all ${
                  on ? 'bg-brand-strong/15 text-brand-strong ring-1 ring-brand-strong/40' : 'border border-border'
                }`}
              >
                <span>{b.emoji}</span>
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

        <Field label="角色与素材版权声明" hint="说明角色设定、头像的原创归属或授权来源；申请公开时必填。">
          <textarea aria-label="角色与素材版权声明"
            value={draft.copyrightStatement} onChange={e=>set('copyrightStatement',e.target.value)} maxLength={1000} className={`${INPUT_CLS} h-24 resize-y`} />
        </Field>
        <p className="text-sm text-muted-foreground">申请公开后进入审核，通过后才会展示在广场。修改公开内容需重新审核。</p>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-secondary/50 px-3.5 py-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium leading-tight">{"公开发布"}</span>
          <span className="text-xs text-muted-foreground">{"关闭后仅自己可查看和聊天"}</span>
        </span>
        <Toggle checked={draft.isPublic} onChange={(v) => set('isPublic', v)} label={"公开发布"} />
      </label>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-secondary/50 px-3.5 py-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium leading-tight">{"成人内容（18+）"}</span>
          <span className="text-xs text-muted-foreground">
            {"该角色包含成人主题，仅面向成年人"}</span>
        </span>
        <Toggle checked={draft.isAdult} onChange={(v) => set('isAdult', v)} label={"成人内容 18+"} />
      </label>

      <ul className="space-y-1.5 rounded-xl border bg-muted/20 p-3.5">
        {SECTIONS.map((s) => {
          const ok = done[s.id];
          return (
            <li key={s.id} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <span className={ok ? 'text-foreground' : 'text-amber-500'}>{ok ? "已完成" : "未完成"}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
