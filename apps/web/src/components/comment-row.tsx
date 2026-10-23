'use client';

import Link from 'next/link';
import { Heart, Reply, Trash2, Pencil, Flag } from 'lucide-react';
import { compactNumber } from '@web/lib/i18n';
import type { CommentNode } from './use-character-comments';

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

export function CommentRow({
  node,
  compact,
  maxBody,
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
  maxBody: number;
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
          <span className={`${size} flex items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white`}>
            {name[0]?.toUpperCase()}
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <Link
            href={`/profile/${encodeURIComponent(node.author.username)}`}
            className="truncate text-xs font-bold text-white hover:underline"
          >
            {name}
          </Link>
          <span className="shrink-0 text-[10px] text-zinc-600">{ago(node.createdAt)}</span>
        </p>

        {editing ? (
          <div className="mt-1">
            <textarea
              value={editDraft}
              onChange={(e) => onEditDraft(e.target.value.slice(0, maxBody))}
              rows={2}
              autoFocus
              className="w-full resize-none rounded-xl border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-brand-strong/50 focus:outline-hidden"
            />
            <div className="mt-1 flex justify-end gap-2">
              <button
                onClick={onCancelEdit}
                className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-400 hover:bg-white/5"
              >
                {"取消"}</button>
              <button
                onClick={onSaveEdit}
                disabled={busy || !editDraft.trim()}
                className="rounded-full bg-zinc-700 px-3 py-1 text-[11px] font-bold text-white hover:bg-zinc-600 disabled:opacity-40"
              >
                {"保存"}</button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-300">
            {node.body}
          </p>
        )}

        <div className="mt-1 flex items-center gap-1">
          <button
            onClick={onLike}
            aria-label={node.hasLiked ? "取消评论点赞" : "点赞评论"}
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-colors ${
              node.hasLiked ? 'text-pink-400' : 'text-zinc-500 hover:text-pink-400'
            }`}
          >
            <Heart className={`h-3 w-3 ${node.hasLiked ? 'fill-current' : ''}`} />
            {node.likeCount > 0 && compactNumber(node.likeCount)}
          </button>

          {onReply && (
            <button
              onClick={onReply}
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-200"
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
