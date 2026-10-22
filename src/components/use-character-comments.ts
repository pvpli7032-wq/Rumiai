'use client';

import { useCallback, useEffect, useState } from 'react';
import { zhError } from '@/lib/copy/zh';

export interface CommentAuthor {
  id: string;
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface CommentNode {
  id: string;
  body: string;
  likeCount: number;
  createdAt: string;
  author: CommentAuthor;
  isMine: boolean;
  hasLiked: boolean;
  replies?: CommentNode[];
  replyCount?: number;
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

/**
 * 角色评论的数据层：取列表、发评论、点赞、改、删，并把结果写回两层的评论树。
 * 渲染在 character-comments.tsx / comment-row.tsx，这里不含任何 JSX。
 */
export function useCharacterComments(characterId: string, token: string | null, requireLogin: () => boolean) {
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

  /** 返回是否发送成功；草稿的清理留给调用方，因为草稿属于界面状态。 */
  async function post(body: string, parentId?: string): Promise<boolean> {
    if (requireLogin() || !body.trim()) return false;
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
      return false;
    }
    // Re-read rather than splicing: a reply belongs under its root, and the server decides
    // which root that is when you reply to a reply.
    await load();
    return true;
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

  async function saveEdit(id: string, body: string) {
    if (!body.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/comments/${id}`, {
      method: 'PATCH',
      headers: { ...headers(), 'Content-Type': 'application/json' } as HeadersInit,
      body: JSON.stringify({ body: body.trim() }),
    });
    setBusy(false);
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

  return { comments, nextCursor, loading, busy, error, load, post, toggleLike, saveEdit, remove };
}
