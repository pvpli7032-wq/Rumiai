'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Loader2 } from 'lucide-react';
import { useAuth } from '@web/lib/auth-context';
import { loginWithNext } from '@web/lib/next-path';
import { readNumber, useUiConfig } from '@web/lib/settings/use-ui-config';
import { ReportDialog } from '@/components/moderation/report-dialog';
import { CommentRow } from '@/components/community/comment-row';
import { useCharacterComments } from './use-character-comments';

/** 配置未到达时的兜底值；真实上限来自设置中心 content.comment.maxChars，服务端按它校验。 */
const DEFAULT_MAX_BODY = 2_000;

export function CharacterComments({ characterId }: { characterId: string }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const maxBody = readNumber(useUiConfig(), 'content.comment.maxChars') ?? DEFAULT_MAX_BODY;
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [reportingId, setReportingId] = useState<string | null>(null);

  function requireLogin(): boolean {
    if (token) return false;
    router.push(loginWithNext());
    return true;
  }

  const { comments, nextCursor, loading, busy, error, load, post, toggleLike, saveEdit, remove } = useCharacterComments(characterId, token, requireLogin);

  async function send(body: string, parentId?: string) {
    if (!await post(body, parentId)) return;
    setDraft('');
    setReplyDraft('');
    setReplyTo(null);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      {/* Composer */}
      <div className="mb-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, maxBody))}
          rows={2}
          placeholder={token ? "写下评论…" : "登录后发表评论"}
          onFocus={() => { if (!token) router.push(loginWithNext()); }}
          className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-brand-strong/50 focus:outline-hidden"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{draft.length}/{maxBody}</span>
          <button
            onClick={() => send(draft)}
            disabled={busy || !draft.trim()}
            className="flex items-center gap-1.5 rounded-full bg-brand-strong px-4 py-1.5 text-xs font-bold text-white hover:bg-[#d94a22] disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {"发送"}</button>
        </div>
      </div>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      {comments.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {"暂无评论，来发表第一条吧"}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentRow
                node={c}
                maxBody={maxBody}
                editing={editingId === c.id}
                editDraft={editDraft}
                busy={busy}
                onEditDraft={setEditDraft}
                onStartEdit={() => { setEditingId(c.id); setEditDraft(c.body); }}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => { void saveEdit(c.id, editDraft); setEditingId(null); }}
                onLike={() => toggleLike(c)}
                onReply={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyDraft(''); }}
                onDelete={() => { if (window.confirm('确定删除这条评论吗？')) void remove(c.id); }}
                onReport={() => setReportingId(c.id)}
              />

              {replyTo === c.id && (
                <div className="ml-10 mt-2">
                  <textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value.slice(0, maxBody))}
                    rows={2}
                    autoFocus
                    placeholder={"回复 " + (c.author.name || c.author.username)}
                    className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-brand-strong/50 focus:outline-hidden"
                  />
                  <div className="mt-1 flex justify-end gap-2">
                    <button
                      onClick={() => setReplyTo(null)}
                      className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      {"取消"}</button>
                    <button
                      onClick={() => send(replyDraft, c.id)}
                      disabled={busy || !replyDraft.trim()}
                      className="rounded-full bg-muted px-3 py-1 text-[11px] font-bold text-white hover:bg-muted disabled:opacity-40"
                    >
                      {"回复"}</button>
                  </div>
                </div>
              )}

              {c.replies && c.replies.length > 0 && (
                <ul className="ml-10 mt-2 space-y-2 border-l border-border pl-3">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <CommentRow
                        node={r}
                        maxBody={maxBody}
                        compact
                        editing={editingId === r.id}
                        editDraft={editDraft}
                        busy={busy}
                        onEditDraft={setEditDraft}
                        onStartEdit={() => { setEditingId(r.id); setEditDraft(r.body); }}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={() => { void saveEdit(r.id, editDraft); setEditingId(null); }}
                        onLike={() => toggleLike(r)}
                        onDelete={() => { if (window.confirm('确定删除这条评论吗？')) void remove(r.id); }}
                        onReport={() => setReportingId(r.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <button
          onClick={() => load(nextCursor)}
          className="mt-4 w-full rounded-full border border-border py-2 text-xs text-muted-foreground hover:bg-muted"
        >
          {"加载更多评论"}</button>
      )}

      {reportingId && (
        <ReportDialog
          targetType="COMMENT"
          targetId={reportingId}
          targetName={"这条评论"}
          onClose={() => setReportingId(null)}
        />
      )}
    </div>
  );
}
