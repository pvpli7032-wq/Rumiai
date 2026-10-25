'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CreatorSteps } from './creator-steps';
import {
  CreatorToolbar, CreatorRail, CreatorPreviewAside, CreatorStepNav, CreatorMobileBar, CreatorPreviewSheet,
} from './creator-chrome';
import { useCreatorForm } from './use-creator-form';

export default function CreatorForm({ editId }: { editId?: string }) {
  const [showPreview, setShowPreview] = useState(false);
  const form = useCreatorForm(editId);
  const { draft, active, done, progress, stepIndex, isLast, error, saving, loaded, savedAt, labelOf } = form;

  const previousStep = useRef(active);
  useEffect(() => {
    if (previousStep.current === active) return;
    previousStep.current = active;
    const heading = document.getElementById(`${active}-title`);
    heading?.focus({preventScroll:true});
    heading?.scrollIntoView({block:'start',behavior:'smooth'});
  }, [active]);

  return (
    <div className="min-h-full bg-background pb-44 desktop:pb-24">
      <section className="border-b border-border bg-secondary/50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 md:px-8">
          <div><p className="text-sm font-semibold text-brand">创作工作区</p><h1 className="mt-1 text-2xl font-semibold">{editId ? '继续完善你的角色' : '把你的想象，写成一个角色。'}</h1><p className="mt-1 text-sm text-muted-foreground">草稿会保存在当前设备；公开作品将按服务端规则进入审核。</p></div>
          <Link href="/my-characters" className="inline-flex min-h-11 items-center rounded-xl border border-input bg-card px-4 text-sm font-semibold hover:bg-accent">管理我的作品</Link>
        </div>
      </section>
      <CreatorToolbar
        editId={editId}
        draft={draft}
        active={active}
        done={done}
        progress={progress}
        savedAt={savedAt}
        saving={saving || form.uploadBusy}
        loaded={loaded}
        onSelectSection={form.goTo}
        onReset={form.reset}
        onPreview={setShowPreview}
        onSubmit={() => void form.submit()}
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 px-4 py-5 md:px-8 desktop:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_280px]">
        <CreatorRail active={active} done={done} onSelectSection={form.goTo} />

        <div className="min-w-0 space-y-6">
          {error && (
            <p role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>
          )}

          <CreatorSteps
            active={active}
            draft={draft}
            set={form.set}
            blur={form.blur}
            toggleIn={form.toggleIn}
            touched={form.touched}
            errors={form.errors}
            done={done}
            LIMITS={form.LIMITS}
            token={form.token}
            tagQuery={form.tagQuery}
            setTagQuery={form.setTagQuery}
            filteredGroups={form.filteredGroups}
            labelOf={labelOf}
            badges={form.badges}
            uploadBusy={form.uploadBusy}
            setUploadBusy={form.setUploadBusy}
          />

          <CreatorStepNav
            editId={editId}
            draft={draft}
            stepIndex={stepIndex}
            isLast={isLast}
            saving={saving || form.uploadBusy}
            loaded={loaded}
            onPrev={form.prevStep}
            onNext={form.nextStep}
            onSubmit={() => void form.submit()}
          />
        </div>

        <CreatorPreviewAside draft={draft} labelOf={labelOf} />
      </div>

      <CreatorMobileBar
        editId={editId}
        draft={draft}
        progress={progress}
        isLast={isLast}
        saving={saving || form.uploadBusy}
        loaded={loaded}
        onNext={form.nextStep}
        onSubmit={() => void form.submit()}
      />

      <CreatorPreviewSheet open={showPreview} draft={draft} labelOf={labelOf} onClose={() => setShowPreview(false)} />
    </div>
  );
}
