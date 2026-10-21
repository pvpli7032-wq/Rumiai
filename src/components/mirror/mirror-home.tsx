'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, SkeletonText} from '@/components/ui';
import {api, ApiError} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {useAuth} from '@/lib/auth-context';

import {MirrorAnswerForm} from './answer-form';
import {MirrorCharacterPicker} from './character-picker';
import {MirrorQuotaNote} from './quota-note';
import {MirrorResultCard} from './result-card';
import {MirrorActions} from './mirror-actions';
import type {MirrorGenerateResponse, MirrorPageResponse} from './client-types';

/**
 * 他眼中的你：选角色 → 答题 → 一次生成 → 结果。
 * 额度、题数、字数上限全部来自服务端设置；前端只负责流程，不复制规则。
 */
export function MirrorHome({initialPage, locale}: {initialPage: MirrorPageResponse | null; locale: string}) {
  const router = useRouter();
  const {token} = useAuth();
  const [page, setPage] = useState<MirrorPageResponse | null>(initialPage);
  const [loading, setLoading] = useState(!initialPage);
  const [error, setError] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(initialPage?.characters[0]?.id ?? null);
  const [answers, setAnswers] = useState<string[]>(() => Array.from({length: initialPage?.rules.questionCount ?? 3}, () => ''));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<MirrorGenerateResponse['result'] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<MirrorPageResponse>(API.mirror.generate, {token});
      setPage(data);
      setCharacterId(current => current ?? data.characters[0]?.id ?? null);
      setAnswers(current => Array.from({length: data.rules.questionCount}, (_, index) => current[index] ?? ''));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '暂时无法打开他眼中的你。');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 页面在服务端不能写 Cookie，首次挂载时用初始化接口给匿名访客签发主体标识。
  useEffect(() => { if (!initialPage) void load(); }, [initialPage, load]);

  const rules = page?.rules ?? null;
  const selected = useMemo(() => page?.characters.find(item => item.id === characterId) ?? null, [page, characterId]);

  async function generate() {
    if (!rules || !characterId || !page) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await api.post<MirrorGenerateResponse>(API.mirror.generate, {characterId, answers}, {token});
      setResult(data.result);
      setPage({...page, quota: data.quota, mine: [{shareId: data.result.shareId, title: data.result.title, characterName: data.result.characterName, characterAvatarUrl: data.result.characterAvatarUrl, createdAt: data.result.createdAt}, ...page.mine]});
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '生成失败，请稍后重试。');
      void load();
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setResult(null);
    setCharacterId(page?.characters[0]?.id ?? null);
    setAnswers(Array.from({length: rules?.questionCount ?? 3}, () => ''));
  }

  if (loading) return <Card><CardContent className="pt-5"><SkeletonText lines={4} /></CardContent></Card>;
  if (error && !page) return <ErrorState title="暂时无法打开他眼中的你" description={error} action={<Button onClick={load}>重试</Button>} />;
  if (!page || !rules) return null;

  if (!rules.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>他眼中的你暂时关闭</CardTitle>
          <CardDescription>入口已暂停开放，已有结果仍可打开分享链接查看。</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <MirrorQuotaNote quota={page.quota} />
      {error && <ErrorState title="刚才没有成功" description={error} />}

      {result ? (
        <section className="space-y-4" aria-live="polite">
          <MirrorResultCard fields={result} />
          <MirrorActions characterId={result.characterId} onAgain={reset} canShare onShare={() => router.push(`/${locale}/mirror/${result.shareId}`)} />
          <Link href={`/${locale}/mirror/${result.shareId}`} className="inline-block text-sm text-brand underline-offset-4 hover:underline">打开结果页</Link>
        </section>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>先选一个角色</CardTitle>
              <CardDescription>回答 {rules.questionCount} 道题，TA 会说出眼中的你。</CardDescription>
            </CardHeader>
            <CardContent>
              <MirrorCharacterPicker characters={page.characters} value={characterId} onChange={setCharacterId} disabled={submitting} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{selected ? `回答${selected.name}的问题` : '回答问题'}</CardTitle>
              <CardDescription>每题不超过 {rules.answerMaxChars} 字；回答只会用于这次生成。</CardDescription>
            </CardHeader>
            <CardContent>
              <MirrorAnswerForm
                rules={rules}
                answers={answers}
                submitting={submitting}
                disabled={!page.quota.canGenerate || !characterId}
                onChange={(index, value) => setAnswers(current => current.map((item, i) => (i === index ? value : item)))}
                onSubmit={generate}
              />
            </CardContent>
          </Card>
        </>
      )}

      {page.mine.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>我最近的结果</CardTitle>
            <CardDescription>只列出还能打开的结果；过期或删除后不再显示。</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {page.mine.map(item => (
                <li key={item.shareId} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/${locale}/mirror/${item.shareId}`} className="min-w-0 truncate text-sm text-foreground hover:underline">
                    {item.title} · {item.characterName}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
