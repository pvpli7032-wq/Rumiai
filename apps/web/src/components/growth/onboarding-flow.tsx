'use client';

import {useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {api, ApiError} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {useAuth} from '@web/lib/auth-context';
import {Button, Card, ErrorState, Skeleton} from '@rumiai/ui';
import {DEFAULT_AFTER_LOGIN, loginWithNext} from '@web/lib/next-path';
import {InterestStep, RecommendedStep, StartStep, StepProgress} from './onboarding-steps';
import type {OnboardingPayload} from './types';

const STEP_HEADINGS = {
  1: {title: '你对什么感兴趣？', hint: '选几个标签，我们按兴趣推荐角色；一个都不选也可以直接下一步。'},
  2: {title: '推荐角色', hint: '挑一个最想聊的，稍后直接开始。'},
  3: {title: '开始第一次互动', hint: '确认一下，就可以开口说第一句话了。'},
} as const;

export function OnboardingFlow() {
  const {token, isLoading: authLoading} = useAuth();
  const router = useRouter();
  const [payload, setPayload] = useState<OnboardingPayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [interests, setInterests] = useState<string[]>([]);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.replace(loginWithNext());
      return;
    }
    const controller = new AbortController();
    setPayload(null);
    setLoadError('');
    api
      .get<OnboardingPayload>(API.growth.onboarding, {token, signal: controller.signal})
      .then(data => {
        if (controller.signal.aborted) return;
        // 开关关闭或已经引导过：不拦人，直接放行到发现页。
        if (!data.enabled || data.completed) {
          router.replace(DEFAULT_AFTER_LOGIN);
          return;
        }
        setPayload(data);
        setCharacterId(data.recommended[0]?.id ?? null);
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace(loginWithNext());
          return;
        }
        setLoadError(cause instanceof ApiError ? cause.message : '引导加载失败，请稍后重试。');
      });
    return () => controller.abort();
  }, [token, authLoading, reloadToken, router]);

  function toggleInterest(tag: string) {
    setInterests(current => (current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag]));
  }

  async function finish(skipped: boolean) {
    if (!token || busy) return;
    setBusy(true);
    setSubmitError('');
    try {
      await api.post(API.growth.onboarding, {interests, ...(skipped ? {skipped: true} : {})}, {token});
      // 成功后保持 busy，页面随即跳走，避免重复提交。
      if (skipped || !characterId) router.replace(DEFAULT_AFTER_LOGIN);
      else router.push(`/chat?character=${encodeURIComponent(characterId)}`);
    } catch (cause) {
      setSubmitError(cause instanceof ApiError ? cause.message : '保存失败，请稍后重试。');
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-2xl p-4">
        <ErrorState
          title="引导加载失败"
          description={loadError}
          action={
            <Button variant="outline" onClick={() => setReloadToken(value => value + 1)}>
              重试
            </Button>
          }
        />
      </main>
    );
  }

  if (!payload) {
    return (
      <main aria-busy className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4">
        <span role="status" className="sr-only">
          正在加载引导…
        </span>
        <Skeleton shape="text" className="h-6 w-40" />
        <Skeleton shape="text" className="w-3/4" />
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </main>
    );
  }

  const heading = STEP_HEADINGS[step];
  const selectedCharacter = payload.recommended.find(character => character.id === characterId) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">新手引导</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground">欢迎来到星伴</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">三步挑一个聊得来的角色，随时可以跳过。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void finish(true)} disabled={busy}>
          跳过引导
        </Button>
      </header>

      <StepProgress step={step} />

      <Card>
        <div className="space-y-4 p-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">{heading.title}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{heading.hint}</p>
          </div>
          {step === 1 && <InterestStep tags={payload.interestTags} selected={interests} onToggle={toggleInterest} />}
          {step === 2 && (
            <RecommendedStep characters={payload.recommended} selectedId={characterId} onSelect={setCharacterId} />
          )}
          {step === 3 && <StartStep character={selectedCharacter} interests={interests} />}
        </div>
      </Card>

      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={() => setStep(current => (current === 3 ? 2 : 1))} disabled={step === 1 || busy}>
          上一步
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep(current => (current === 1 ? 2 : 3))} disabled={busy}>
            下一步
          </Button>
        ) : (
          <Button onClick={() => void finish(false)} loading={busy}>
            {selectedCharacter ? `和${selectedCharacter.name}开始聊天` : '开始第一次互动'}
          </Button>
        )}
      </div>
    </main>
  );
}
