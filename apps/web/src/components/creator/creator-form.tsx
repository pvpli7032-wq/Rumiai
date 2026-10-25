'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {CreatorCloudDraft} from './creator-cloud-draft';
import { CreatorSteps } from './creator-steps';
import {
  CreatorToolbar, CreatorRail, CreatorPreviewAside, CreatorStepNav, CreatorMobileBar, CreatorPreviewSheet,
} from './creator-chrome';
import { useCreatorForm } from './use-creator-form';
import type {CharacterCreationQuota} from '@rumiai/contracts/characters/limits';

export default function CreatorForm({ editId }: { editId?: string }) {
  const [showPreview, setShowPreview] = useState(false);
  const form = useCreatorForm(editId);
  const [quota, setQuota] = useState<CharacterCreationQuota | null>(null);
  const [quotaOwner, setQuotaOwner] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState('');
  const [quotaReload, setQuotaReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setQuota(null); setQuotaError(''); setQuotaOwner(form.token);
    if (!form.token || editId) return () => controller.abort();
    void fetch('/api/characters/creation-quota', {headers: {Authorization: 'Bearer ' + form.token}, signal: controller.signal, cache: 'no-store'})
      .then(async response => {const data = await response.json(); if (!response.ok) throw new Error(data.error || '角色额度读取失败。'); if (!controller.signal.aborted) setQuota(data);})
      .catch(error => {if (!controller.signal.aborted) setQuotaError(error instanceof TypeError ? '角色额度暂时无法读取，请重试。' : error.message);});
    return () => controller.abort();
  }, [form.token, editId, quotaReload]);
  const visibleQuota = quotaOwner === form.token ? quota : null;
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
          <CreatorCloudDraft slot={editId??'new'} draft={draft} onRestore={value=>form.setDraft(value)} onTest={()=>void form.previewChat()}/>
          {error && (
            <p role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>
          )}

          {!editId && <section aria-label="角色创建额度" className="rounded-xl border border-border bg-card p-4 text-sm">
            <h2 className="font-medium">角色创建额度</h2>
            {quotaError ? <p role="alert" className="mt-2 text-muted-foreground">{quotaError} <button type="button" onClick={() => setQuotaReload(value => value + 1)} className="min-h-11 underline">重试</button></p> : !visibleQuota ? <p role="status" className="mt-2 text-muted-foreground">正在读取有效额度…</p> : <div className="mt-2 space-y-1 text-muted-foreground">
              <p>已创建 {visibleQuota.used} 个 · 当前上限 {visibleQuota.effectiveLimit ?? '不限制'}{visibleQuota.remaining === null ? '' : ` · 可再创建 ${visibleQuota.remaining} 个`}</p>
              <p>公共上限：{visibleQuota.publicLimit ?? '不限制'}；会员上限：{visibleQuota.membershipLimit ?? '未配置有效扩额'}。{visibleQuota.source === 'MEMBERSHIP' ? '当前使用会员扩额。' : visibleQuota.source === 'PUBLIC_UNLIMITED' ? '公共规则不限制，会员不会降低额度。' : '当前按公共规则生效。'}</p>
              {visibleQuota.remaining === 0 && <p>已达到创建上限，可查看<Link href="/membership" className="ml-1 underline">会员权益</Link>；现有角色仍可继续编辑。</p>}
            </div>}
          </section>}

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
