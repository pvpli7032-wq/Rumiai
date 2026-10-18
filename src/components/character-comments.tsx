'use client';
import { zhError } from '@/lib/copy/zh';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, Reply, Trash2, Pencil, Flag, Send, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { loginWithNext } from '@/lib/next-path';
import { compactNumber } from '@/lib/i18n';
import { ReportDialog } from './report-dialog';

interface Author {
  id: string;
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
}

interface CommentNode {
  id: string;
  body: string;
  likeCount: number;
  createdAt: string;
  author: Author;
  isMine: boolean;
  hasLiked: boolean;
  replies?: CommentNode[];
  replyCount?: number;
}

const MAX_BODY = 2_000;

/** "3 分钟前" — relative time, since a comment's age matters more than its date. */
function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return "" + (minutes) + "分钟前";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return "" + (hours) + "小时前";
  const days = Math.floor(hours / 24);
  if (days < 30) return "" + (days) + "天前";
  return new Date(iso).toLocaleDateString('th-TH');
}

export function CharacterComments({ characterId }: { characterId: string }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const headers = useCallback(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  const load = useCallback(
    async (cursor?: string) => {
      // The token is sent so each comment comes back with whether *this* reader liked it.
      const url = `/api/characters/${characterId}/comments${cursor ? `?cursor=${cursor}` : ''}`;
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) { setError("评论加载失败"); return; }
      const data = await res.json();
      setComments((prev) => (cursor ? [...prev, ...data.comments] : data.comments));
      setNextCursor(data.nextCursor);
    },
    [characterId, headers],
  );

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  function requireLogin(): boolean {
    if (token) return false;
    router.push(loginWithNext());
    return true;
  }

  async function post(body: string, parentId?: string) {
    if (requireLogin() || !body.trim()) return;
    setBusy(true);
    setError('');
    const res = await fetch(`/api/characters/${characterId}/comments`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' } as HeadersInit,
      body: JSON.stringify({ body: body.trim(), parent_id: parentId }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(zhError(payload.error || '') || "评论发送失败");
      return;
    }
    // Re-read rather than splicing: a reply belongs under its root, and the server decides
    // which root that is when you reply to a reply.
    await load();
    setDraft('');
    setReplyDraft('');
    setReplyTo(null);
  }

  async function toggleLike(node: CommentNode) {
    if (requireLogin()) return;
    const method = node.hasLiked ? 'DELETE' : 'POST';
    // Optimistic; the server is idempotent so a double tap cannot double count.
    setComments((prev) => mapTree(prev, node.id, (c) => ({
      ...c,
      hasLiked: !node.hasLiked,
      likeCount: Math.max(0, c.likeCount + (node.hasLiked ? -1 : 1)),
    })));
    const res = await fetch(`/api/comments/${node.id}/like`, { method, headers: headers() });
    if (!res.ok) { await load(); return; }
    const data = await res.json().catch(() => ({}));
    if (typeof data.likeCount === 'number') {
      setComments((prev) => mapTree(prev, node.id, (c) => ({ ...c, likeCount: data.likeCount })));
    }
  }

  async function saveEdit(id: string) {
    if (!editDraft.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/comments/${id}`, {
      method: 'PATCH',
      headers: { ...headers(), 'Content-Type': 'application/json' } as HeadersInit,
      body: JSON.stringify({ body: editDraft.trim() }),
    });
    setBusy(false);
    setEditingId(null);
    if (res.ok) {
      const { comment } = await res.json();
      setComments((prev) => mapTree(prev, id, (c) => ({ ...c, body: comment.body })));
    }
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await fetch(`/api/comments/${id}`, { method: 'DELETE', headers: headers() });
    setBusy(false);
    if (res.ok) await load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div>
      {/* Composer */}
      <div className="mb-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
          rows={2}
          placeholder={token ? "写下评论…" : "登录后发表评论"}
          onFocus={() => { if (!token) router.push(loginWithNext()); }}
          className="w-full resize-none rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 font-athiti text-sm text-white placeholder-zinc-600 focus:border-[#F2572B]/50 focus:outline-hidden"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="font-barlow text-[11px] text-zinc-600">{draft.length}/{MAX_BODY}</span>
          <button
            onClick={() => post(draft)}
            disabled={busy || !draft.trim()}
            className="flex items-center gap-1.5 rounded-full bg-[#F2572B] px-4 py-1.5 font-athiti text-xs font-bold text-white hover:bg-[#d94a22] disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {"发送"}</button>
        </div>
      </div>

      {error && <p className="mb-3 font-athiti text-xs text-red-400">{error}</p>}

      {comments.length === 0 ? (
        <p className="py-6 text-center font-athiti text-sm text-zinc-500">
          {"暂无评论，来发表第一条吧"}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentRow
                node={c}
                editing={editingId === c.id}
                editDraft={editDraft}
                busy={busy}
                onEditDraft={setEditDraft}
                onStartEdit={() => { setEditingId(c.id); setEditDraft(c.body); }}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => saveEdit(c.id)}
                onLike={() => toggleLike(c)}
                onReply={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyDraft(''); }}
                onDelete={() => remove(c.id)}
                onReport={() => setReportingId(c.id)}
              />

              {replyTo === c.id && (
                <div className="ml-10 mt-2">
                  <textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value.slice(0, MAX_BODY))}
                    rows={2}
                    autoFocus
                    placeholder={"回复 " + (c.author.name || c.author.username)}
                    className="w-full resize-none rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 font-athiti text-xs text-white placeholder-zinc-600 focus:border-[#F2572B]/50 focus:outline-hidden"
                  />
                  <div className="mt-1 flex justify-end gap-2">
                    <button
                      onClick={() => setReplyTo(null)}
                      className="rounded-full border border-white/10 px-3 py-1 font-athiti text-[11px] text-zinc-400 hover:bg-white/5"
                    >
                      {"取消"}</button>
                    <button
                      onClick={() => post(replyDraft, c.id)}
                      disabled={busy || !replyDraft.trim()}
                      className="rounded-full bg-zinc-700 px-3 py-1 font-athiti text-[11px] font-bold text-white hover:bg-zinc-600 disabled:opacity-40"
                    >
                      {"回复"}</button>
                  </div>
                </div>
              )}

              {c.replies && c.replies.length > 0 && (
                <ul className="ml-10 mt-2 space-y-2 border-l border-white/10 pl-3">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <CommentRow
                        node={r}
                        compact
                        editing={editingId === r.id}
                        editDraft={editDraft}
                        busy={busy}
                        onEditDraft={setEditDraft}
                        onStartEdit={() => { setEditingId(r.id); setEditDraft(r.body); }}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={() => saveEdit(r.id)}
                        onLike={() => toggleLike(r)}
                        onDelete={() => remove(r.id)}
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
          className="mt-4 w-full rounded-full border border-white/10 py-2 font-athiti text-xs text-zinc-300 hover:bg-white/5"
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

/** Applies `fn` to one node anywhere in the two-level tree. */
function mapTree(
  list: CommentNode[],
  id: string,
  fn: (node: CommentNode) => CommentNode
): CommentNode[] {
  return list.map((c) => {
    if (c.id === id) return fn(c);
    if (c.replies?.some((r) => r.id === id)) {
      return { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) };
    }
    return c;
  });
}

function CommentRow({
  node,
  compact,
  editing,
  editDraft,
  busy,
  onEditDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onLike,
  onReply,
  onDelete,
  onReport,
}: {
  node: CommentNode;
  compact?: boolean;
  editing: boolean;
  editDraft: string;
  busy: boolean;
  onEditDraft: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onLike: () => void;
  onReply?: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  const name = node.author.name || node.author.username;
  const size = compact ? 'h-7 w-7' : 'h-9 w-9';

  return (
    <div className="group/c flex gap-2.5">
      <Link href={`/profile/${encodeURIComponent(node.author.username)}`} className="shrink-0">
        {node.author.avatarUrl ? (
          <img src={node.author.avatarUrl} alt={name} className={`${size} rounded-full object-cover`} />
        ) : (
          <span className={`${size} flex items-center justify-center rounded-full bg-linear-to-br/srgb from-[#EE4036] to-[#FAAF40] font-athiti text-xs font-bold text-white`}>
            {name[0]?.toUpperCase()}
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <Link
            href={`/profile/${encodeURIComponent(node.author.username)}`}
            className="truncate font-athiti text-xs font-bold text-white hover:underline"
          >
            {name}
          </Link>
          <span className="shrink-0 font-barlow text-[10px] text-zinc-600">{ago(node.createdAt)}</span>
        </p>

        {editing ? (
          <div className="mt-1">
            <textarea
              value={editDraft}
              onChange={(e) => onEditDraft(e.target.value.slice(0, MAX_BODY))}
              rows={2}
              autoFocus
              className="w-full resize-none rounded-xl border border-white/10 bg-zinc-900 px-2.5 py-1.5 font-athiti text-xs text-white focus:border-[#F2572B]/50 focus:outline-hidden"
            />
            <div className="mt-1 flex justify-end gap-2">
              <button
                onClick={onCancelEdit}
                className="rounded-full border border-white/10 px-3 py-1 font-athiti text-[11px] text-zinc-400 hover:bg-white/5"
              >
                {"取消"}</button>
              <button
                onClick={onSaveEdit}
                disabled={busy || !editDraft.trim()}
                className="rounded-full bg-zinc-700 px-3 py-1 font-athiti text-[11px] font-bold text-white hover:bg-zinc-600 disabled:opacity-40"
              >
                {"保存"}</button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words font-athiti text-sm text-zinc-300">
            {node.body}
          </p>
        )}

        <div className="mt-1 flex items-center gap-1">
          <button
            onClick={onLike}
            aria-label={node.hasLiked ? "取消评论点赞" : "点赞评论"}
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 font-barlow text-[11px] transition-colors ${
              node.hasLiked ? 'text-pink-400' : 'text-zinc-500 hover:text-pink-400'
            }`}
          >
            <Heart className={`h-3 w-3 ${node.hasLiked ? 'fill-current' : ''}`} />
            {node.likeCount > 0 && compactNumber(node.likeCount)}
          </button>

          {onReply && (
            <button
              onClick={onReply}
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-athiti text-[11px] text-zinc-500 hover:text-zinc-200"
            >
              <Reply className="h-3 w-3" />
              {"回复"}{node.replyCount ? ` (${node.replyCount})` : ''}
            </button>
          )}

          {node.isMine && !editing && (
            <>
              <IconOnly label={"编辑评论"} onClick={onStartEdit}>
                <Pencil className="h-3 w-3" />
              </IconOnly>
              <IconOnly label={"删除评论"} onClick={onDelete}>
                <Trash2 className="h-3 w-3" />
              </IconOnly>
            </>
          )}

          {!node.isMine && (
            <IconOnly label={"举报评论"} onClick={onReport}>
              <Flag className="h-3 w-3" />
            </IconOnly>
          )}
        </div>
      </div>
    </div>
  );
}

function IconOnly({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-full p-1 text-zinc-600 opacity-0 transition-all hover:text-zinc-200 focus-visible:opacity-100 group-hover/c:opacity-100"
    >
      {children}
    </button>
  );
}
