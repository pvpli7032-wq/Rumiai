'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Connection = { id: string; username: string; name: string; avatar_url: string | null };
export function CreatorConnections({ username, type }: { username: string; type: 'followers' | 'following' }) {
  const [users, setUsers] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void fetch(`/api/creators/${encodeURIComponent(username)}/connections?type=${type}&limit=50`).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '列表加载失败。');
      if (active) setUsers(data.users);
    }).catch(value => { if (active) setError(value instanceof Error ? value.message : '列表加载失败。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [username, type]);
  return <main className="mx-auto w-full max-w-2xl p-4 sm:p-6">
    <Link href={`/profile/${encodeURIComponent(username)}`} className="inline-flex min-h-11 items-center text-orange-500">← 返回创作者主页</Link>
    <h1 className="my-4 text-2xl font-bold">{type === 'followers' ? '粉丝' : '关注的人'}</h1>
    {loading ? <p role="status">正在加载…</p> : error ? <p role="alert">{error}</p> : users.length === 0 ? <p className="text-zinc-500">列表还是空的。</p> : <ul className="divide-y divide-white/10">{users.map(user => <li key={user.id} className="py-3"><Link href={`/profile/${encodeURIComponent(user.username)}`} className="flex min-h-12 items-center gap-3"><span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-zinc-800">{user.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : user.name[0]}</span><span><span className="block text-sm font-medium">{user.name}</span><span className="text-xs text-zinc-500">@{user.username}</span></span></Link></li>)}</ul>}
  </main>;
}
