'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { compactNumber } from '@/lib/i18n';

type ActivityPost = { id: string; content: string; createdAt: string; images: string[]; circle: { id: string; name: string }; character: { id: string; name: string } | null; commentCount: number };

export function CreatorCommunity({ username, initialFollowerCount }: { username: string; initialFollowerCount: number }) {
  const { token, isLoading } = useAuth();
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [isFollowing, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [posts, setPosts] = useState<ActivityPost[]>([]);

  useEffect(() => {
    let active = true;
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    void Promise.all([
      fetch(`/api/creators/${encodeURIComponent(username)}`, { headers }).then(r => r.ok ? r.json() : null),
      fetch(`/api/creators/${encodeURIComponent(username)}/activity?limit=20`).then(r => r.ok ? r.json() : null),
    ]).then(([profile, activity]) => {
      if (!active) return;
      if (profile?.creator) { setFollowerCount(profile.creator.followerCount); setIsFollowing(profile.creator.isFollowing); }
      if (activity?.posts) setPosts(activity.posts);
    }).catch(() => { if (active) setNotice('创作者动态暂时无法加载。'); });
    return () => { active = false; };
  }, [username, token]);

  async function toggleFollow() {
    if (!token) { window.location.assign(`/login?next=${encodeURIComponent(`/profile/${username}`)}`); return; }
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch(`/api/creators/${encodeURIComponent(username)}/follow`, { method: isFollowing ? 'DELETE' : 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '关注操作失败。');
      setIsFollowing(data.following); setFollowerCount(data.followerCount);
    } catch (error) { setNotice(error instanceof Error ? error.message : '关注操作失败，请重试。'); }
    finally { setBusy(false); }
  }

  return <section className="mt-4 space-y-7">
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`/profile/${encodeURIComponent(username)}/connections?type=followers`} className="min-h-11 inline-flex items-center text-sm text-zinc-300">{compactNumber(followerCount)} 位粉丝</Link>
      <Link href={`/profile/${encodeURIComponent(username)}/connections?type=following`} className="min-h-11 inline-flex items-center text-sm text-zinc-400">关注列表</Link>
      {!isLoading && <button disabled={busy} onClick={() => void toggleFollow()} className="min-h-11 rounded-full bg-orange-600 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? '请稍候…' : isFollowing ? '已关注 · 取消关注' : '关注创作者'}</button>}
    </div>
    {notice && <p role="status" className="text-sm text-amber-300">{notice}</p>}
    <div>
      <h2 className="mb-3 font-semibold text-white">创作者动态</h2>
      {posts.length === 0 ? <p className="text-sm text-zinc-500">暂时没有公开动态。</p> : <ul className="space-y-3">{posts.map(post => <li key={post.id} className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
        <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">{post.content}</p>
        {post.images.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto">{post.images.map(image => <img key={image} src={image} alt="帖子图片" loading="lazy" className="h-24 w-24 rounded-lg object-cover" />)}</div>}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <Link href={`/circles/${post.circle.id}#post-${post.id}`} className="text-orange-400">{post.circle.name} · 查看帖子</Link>
          {post.character && <Link href={`/zh/character/${post.character.id}`} className="text-purple-300">关联角色：{post.character.name}</Link>}
          <span>{post.commentCount} 条评论 · {new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      </li>)}</ul>}
    </div>
  </section>;
}
