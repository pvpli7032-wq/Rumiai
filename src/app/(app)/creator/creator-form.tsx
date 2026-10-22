'use client';

import { useState } from 'react';
import { CreatorSteps } from './creator-steps';
import {
  CreatorToolbar, CreatorRail, CreatorPreviewAside, CreatorStepNav, CreatorMobileBar, CreatorPreviewSheet,
} from './creator-chrome';
import { useCreatorForm } from './use-creator-form';

export default function CreatorForm({ editId }: { editId?: string }) {
  const [showPreview, setShowPreview] = useState(false);
  const form = useCreatorForm(editId);
  const { draft, active, done, progress, stepIndex, isLast, error, saving, loaded, savedAt, labelOf } = form;

  return (
    <div className="min-h-screen bg-background pb-40 desktop:pb-24">
      <CreatorToolbar
        editId={editId}
        draft={draft}
        active={active}
        done={done}
        progress={progress}
        savedAt={savedAt}
        saving={saving}
        loaded={loaded}
        onSelectSection={form.goTo}
        onReset={form.reset}
        onPreview={setShowPreview}
        onSubmit={() => void form.submit()}
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-6 md:px-8 desktop:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_280px]">
        <CreatorRail active={active} done={done} onSelectSection={form.goTo} />

        <div className="min-w-0 space-y-6">
          {error && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</p>
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
          />

          <CreatorStepNav
            editId={editId}
            draft={draft}
            stepIndex={stepIndex}
            isLast={isLast}
            saving={saving}
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
        saving={saving}
        loaded={loaded}
        onNext={form.nextStep}
        onSubmit={() => void form.submit()}
      />

      <CreatorPreviewSheet open={showPreview} draft={draft} labelOf={labelOf} onClose={() => setShowPreview(false)} />
    </div>
  );
}
