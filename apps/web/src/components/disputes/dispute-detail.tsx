'use client';
import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Flag} from 'lucide-react';
import {Badge, Button, Dialog} from '@rumiai/ui';
import {API} from '@rumiai/contracts/api-paths';
import {useAuth} from '@web/lib/auth-context';
import type {DisputeCaseDetail, DisputeChoice} from '@rumiai/contracts/disputes/types';
import {ReportDialog} from '@/components/moderation';
import {ExcerptView} from './excerpt-view';
import {VotePanel} from './vote-panel';
import {VerdictCard} from './verdict-card';
import {DisputeComments} from './dispute-comments';
import {caseStateLabel, formatTime, remainingText} from './shared';

type DetailResponse = {case: DisputeCaseDetail & {canVote: boolean; canWithdraw: boolean; canComment: boolean}};

async function readDetail(caseId: string, token: string | null, signal?: AbortSignal) {
  const response = await fetch(API.disputes.detail(caseId), {signal, headers: token ? {Authorization: `Bearer ${token}`} : {}});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '评理案例加载失败。');
  return data as DetailResponse;
}

/** 详情页：摘录、投票、评论、结案。只读展示，结案由后台任务推进。 */
export function DisputeDetail({caseId, locale}: {caseId: string; locale: string}) {
  const {token, isLoading} = useAuth();
  const router = useRouter();
  const [detail, setDetail] = useState<DetailResponse['case'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try { setDetail((await readDetail(caseId, token, signal)).case); }
    catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '加载失败，请重试。'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [caseId, token]);

  useEffect(() => { if (isLoading) return; const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [isLoading, load]);

  async function vote(choice: DisputeChoice) {
    if (!token || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(API.disputes.vote(caseId), {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({choice})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '投票失败，请重试。');
      await load();
      setNotice(data.closing ? '票数已到结案线，正在结案。' : '投票已记录。');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '投票失败，请重试。'); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    if (!token || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(API.disputes.withdraw(caseId), {method: 'POST', headers: {Authorization: `Bearer ${token}`}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '撤回失败，请重试。');
      router.replace(`/${locale}/disputes`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '撤回失败，请重试。'); setBusy(false); }
  }

  if (loading) return <p className="text-sm text-muted-foreground">正在加载评理案例…</p>;
  if (error || !detail) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>{error || '评理案例不存在或已撤回。'}</p>
        <Link href={`/${locale}/disputes`} className="text-brand underline-offset-4 hover:underline">返回评理广场</Link>
      </div>
    );
  }

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={detail.withdrawn ? 'neutral' : detail.closeStatus === 'OPEN' ? 'brand' : detail.closeStatus === 'CLOSED' ? 'success' : 'warning'}>{caseStateLabel(detail)}</Badge>
          <span>{detail.author.name} 发起</span>
          <span>· {formatTime(detail.createdAt)}</span>
          <span>· {detail.closeStatus === 'OPEN' ? `${remainingText(detail.deadlineAt)}（${formatTime(detail.deadlineAt)} 截止）` : `截止 ${formatTime(detail.deadlineAt)}`}</span>
          {detail.character ? <span>· 与「{detail.character.name}」的对话</span> : null}
        </div>
        <h1 className="whitespace-pre-wrap break-words text-xl font-bold leading-snug">{detail.claim}</h1>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setReport(true)}><Flag aria-hidden className="h-3.5 w-3.5" /> 举报案例</Button>
          {detail.canWithdraw ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmWithdraw(true)}>撤回案例</Button> : null}
        </div>
        {notice ? <p role="status" className="break-words text-sm text-muted-foreground">{notice}</p> : null}
      </header>

      <section aria-label="聊天摘录" className="space-y-2">
        <h2 className="text-base font-semibold">聊天摘录 <span className="text-xs font-normal text-muted-foreground">{detail.excerptCount} 条，发起时固定</span></h2>
        <ExcerptView excerpt={detail.excerpt} />
      </section>

      {detail.withdrawn ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">发起人已撤回这个案例，不再公开访问；已公开的截图无法远程收回。</p>
      ) : (
        <VotePanel detail={detail} current={detail.myVote?.choice ?? null} busy={busy} onVote={choice => void vote(choice)} />
      )}

      <VerdictCard verdict={detail.verdict} closeStatus={detail.closeStatus} />

      {detail.canComment && !detail.withdrawn ? <DisputeComments postId={detail.postId} /> : null}

      {confirmWithdraw ? <Dialog open onClose={() => !busy && setConfirmWithdraw(false)} title="撤回案例" description="撤回后案例不再公开，评论与举报记录会保留。" footer={<><Button variant="outline" disabled={busy} onClick={() => setConfirmWithdraw(false)}>保留案例</Button><Button variant="danger" loading={busy} onClick={() => void withdraw()}>确认撤回</Button></>}>此操作无法撤销。</Dialog> : null}

      {report ? <ReportDialog targetType="POST" targetId={detail.postId} targetName={detail.claim.slice(0, 20)} onClose={() => setReport(false)} /> : null}
    </article>
  );
}
