'use client';

import {BackButton} from '@/components/layout/back-button';
import {useEffect,useRef} from 'react';
import { ArrowLeft, Check, Eye, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { LivePreview } from '@/components/creator/live-preview';
import { SECTIONS, type Draft } from './creator-draft';

/** 提交按钮的文案：编辑、公开、私密三种情况各一句。 */
export function submitLabel(editId: string | undefined, isPublic: boolean) {
  return editId ? '保存修改' : isPublic ? '提交审核' : '保存私有角色';
}

export interface CreatorChromeProps {
  editId?: string;
  draft: Draft;
  active: string;
  done: Record<string, boolean>;
  progress: number;
  savedAt: string | null;
  saving: boolean;
  loaded: boolean;
  onSelectSection: (id: string) => void;
  onReset: () => void;
  onPreview: (open: boolean) => void;
  onSubmit: () => void;
}

/** 编辑器的外壳：顶栏、步骤条、步骤导航、移动端提交条与预览面板。 */
export function CreatorToolbar({ editId, draft, active, done, progress, savedAt, saving, loaded, onSelectSection, onReset, onPreview, onSubmit }: CreatorChromeProps) {
  return (
    <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-3 px-4 md:px-8">
        <BackButton fallback="/creator" ariaLabel="返回上一页" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </BackButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight">{editId ? '编辑角色' : '创建角色'}</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {savedAt ? "草稿已自动保存于" + (savedAt) : "草稿会自动保存"}
          </p>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{progress}%</span>
        </div>

        <button onClick={onReset} aria-label={"清空草稿"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-red-500">
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={() => onPreview(true)}
          className="flex h-11 items-center gap-1.5 rounded-full border border-input px-3 text-xs font-medium transition-colors hover:bg-accent xl:hidden"
        >
          <Eye className="h-3.5 w-3.5" />
          {"预览"}</button>
        <button
          onClick={onSubmit}
          disabled={saving || !loaded}
          className="hidden min-h-11 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-95 disabled:opacity-60 desktop:inline-flex"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {submitLabel(editId, draft.isPublic)}</button>
      </div>

      {/* Section nav — chips on mobile */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] desktop:hidden [&::-webkit-scrollbar]:hidden">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelectSection(s.id)}
            aria-current={active === s.id ? 'step' : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-all ${active === s.id ? 'bg-brand text-brand-foreground' : 'border border-border bg-card text-muted-foreground'}`}
          >
            {done[s.id] && <Check className="h-3 w-3" />}
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 左侧步骤轨道（桌面）。 */
export function CreatorRail({ active, done, onSelectSection }: { active: string; done: Record<string, boolean>; onSelectSection: (id: string) => void }) {
  return (
    <nav className="sticky top-36 hidden h-fit space-y-1 desktop:block">
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        const isActive = active === s.id;
        const isDone = done[s.id];
        return (
          <button
            key={s.id}
            onClick={() => onSelectSection(s.id)}
            className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${isActive ? 'bg-accent' : 'hover:bg-accent/60'}`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${
                isDone ? 'bg-emerald-500/15 text-foreground' : isActive ? 'bg-brand-strong/15 text-brand-strong' : 'bg-muted text-muted-foreground'
              }`}
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-bold ${isActive ? '' : 'text-muted-foreground'}`}>{s.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{s.desc}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** 桌面右侧实时预览。 */
export function CreatorPreviewAside({ draft, labelOf }: { draft: Draft; labelOf: (key: string) => string }) {
  return (
    <aside className="sticky top-36 hidden h-fit xl:block">
      <p className="mb-3 text-sm font-bold text-muted-foreground">{"实时预览"}</p>
      <LivePreview data={draft} tagLabel={labelOf} />
    </aside>
  );
}

/** 步骤导航：上一步 / 下一步 / 提交。 */
export function CreatorStepNav({
  editId, draft, stepIndex, isLast, saving, loaded, onPrev, onNext, onSubmit,
}: {
  editId?: string;
  draft: Draft;
  stepIndex: number;
  isLast: boolean;
  saving: boolean;
  loaded: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-3">
      <button
        onClick={onPrev}
        disabled={stepIndex === 0}
        className="inline-flex h-11 items-center rounded-lg border border-input px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40"
      >
        上一步
      </button>
      <span className="flex-1 text-center text-xs tabular-nums text-muted-foreground">
        第 {stepIndex + 1} / {SECTIONS.length} 步 · {SECTIONS[stepIndex].label}
      </span>
      {isLast ? (
        <button
          onClick={onSubmit}
          disabled={saving || !loaded}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-brand px-5 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-95 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {submitLabel(editId, draft.isPublic)}
        </button>
      ) : (
        <button
          onClick={onNext}
          className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-sm font-semibold text-brand-foreground"
        >
          下一步
        </button>
      )}
    </div>
  );
}

/** 移动端底部提交条。 */
export function CreatorMobileBar({
  editId, draft, progress, isLast, saving, loaded, onNext, onSubmit,
}: {
  editId?: string;
  draft: Draft;
  progress: number;
  isLast: boolean;
  saving: boolean;
  loaded: boolean;
  onNext: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm desktop:hidden [[data-keyboard=true]_&]:bottom-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{"已填写"}{progress}%</p>
        </div>
        {isLast ? (
          <button
            onClick={onSubmit}
            disabled={saving || !loaded}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {submitLabel(editId, draft.isPublic)}
          </button>
        ) : (
          <button
            onClick={onNext}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-brand px-5 py-3 text-sm font-semibold text-brand-foreground"
          >
            下一步
          </button>
        )}
      </div>
    </div>
  );
}

/** 移动端实时预览抽屉。 */
export function CreatorPreviewSheet({ open, draft, labelOf, onClose }: { open: boolean; draft: Draft; labelOf: (key: string) => string; onClose: () => void }) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=dialog.current;if(!element)return;if(open&&!element.open)element.showModal();else if(!open&&element.open)element.close();},[open]);
  return <dialog ref={dialog} aria-label="角色预览" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}} className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-transparent p-4 text-foreground backdrop:bg-black/60">
    <div className="absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-[24px] border border-border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-[24px]">
      <h2 className="mb-4 text-lg font-semibold">角色预览</h2>
      <LivePreview data={draft} tagLabel={labelOf} />
      <button type="button" autoFocus onClick={onClose} className="mt-5 min-h-11 w-full rounded-full border border-input font-semibold hover:bg-secondary">关闭</button>
    </div>
  </dialog>;
}
