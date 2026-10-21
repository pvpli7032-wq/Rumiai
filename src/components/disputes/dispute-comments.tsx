'use client';
import {useCallback, useEffect, useState} from 'react';
import {Flag} from 'lucide-react';
import {Button, Textarea} from '@/components/ui';
import {ReportDialog} from '@/components/report-dialog';
import {API} from '@/lib/api-paths';
import {useAuth} from '@/lib/auth-context';
import {MAX_COMMENT_CHARS, formatTime} from './shared';

type Comment = {id: string; content: string; createdAt: string; author: {id: string; name: string; avatar_url: string | null}; isMine: boolean};

/** 评论沿用社区帖子评论：发帖/加载/举报都走既有接口，这里不另建一套。 */
export function DisputeComments({postId}: {postId: string}) {
  const {token} = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<Comment | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/comments`, {signal, headers: token ? {Authorization: `Bearer ${token}`} : {}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '评论加载失败。');
      setComments(data.comments ?? []);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '评论加载失败，请重试。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [postId, token]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  async function submit() {
    if (!token) { setNotice('登录后才能评论。'); return; }
    if (!content.trim() || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/comments`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({content: content.trim(), imageUrl: null})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '评论发布失败，请重试。');
      setContent('');
      setComments(rows => [...rows, data.comment]);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '评论发布失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="评论" className="space-y-3">
      <h2 className="text-base font-semibold">评论 <span className="text-xs font-normal text-muted-foreground">{comments.length} 条</span></h2>
      {loading ? <p className="text-sm text-muted-foreground">正在加载评论…</p> : error ? (
        <p role="alert" className="text-sm text-destructive">{error} <Button size="sm" variant="link" onClick={() => void load()}>重试</Button></p>
      ) : comments.length === 0 ? <p className="text-sm text-muted-foreground">还没有评论，来说说你的看法。</p> : (
        <ul className="space-y-3">
          {comments.map(comment => (
            <li key={comment.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{comment.author.name} · {formatTime(comment.createdAt)}</span>
                <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setReport(comment)}>
                  <Flag aria-hidden className="h-3.5 w-3.5" /> 举报
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{comment.content}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <Textarea value={content} maxLength={MAX_COMMENT_CHARS} rows={3} placeholder={token ? '写下你的看法' : '登录后可以评论'} onChange={event => setContent(event.target.value)} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{content.length}/{MAX_COMMENT_CHARS}</span>
          <Button size="sm" loading={busy} disabled={!content.trim()} onClick={() => void submit()}>发表评论</Button>
        </div>
        {notice ? <p role="status" className="break-words text-sm text-muted-foreground">{notice}</p> : null}
      </div>
      {report ? <ReportDialog targetType="POST_COMMENT" targetId={report.id} targetName={report.author.name} onClose={() => setReport(null)} /> : null}
    </section>
  );
}
