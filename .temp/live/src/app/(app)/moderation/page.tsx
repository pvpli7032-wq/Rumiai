'use client';
import {useCallback, useEffect, useState} from 'react';
import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {BulkCharacterReview} from '@/components/admin/moderation/bulk-character-review';
import {CommunityModeration} from '@/components/admin/moderation/community-moderation';
import {CharacterReviewCard, type ReviewCharacter} from '@/components/admin/moderation/character-review-card';

export default function Moderation() {
  const {token, isLoading} = useAuth();
  const {permissions} = useAdminAccess();
  const canReview = permissions.includes('moderation.write');
  const [characters, setCharacters] = useState<ReviewCharacter[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [reasons, setReasons] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    setCharacters([]); setSelected({}); setLoading(true);
    try {const response = await fetch('/api/moderation/characters', {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal}); const data = await response.json(); if (!response.ok) throw Error(data.error); if (!signal?.aborted) {setCharacters(data); setError('');}}
    catch (value) {if (!signal?.aborted) setError((value as Error).message);}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [token]);
  useEffect(() => {
    const controller = new AbortController();
    if (token) void load(controller.signal);
    else if (!isLoading) {setCharacters([]); setLoading(false); setError('请先登录审核账号。');}
    return () => controller.abort();
  }, [token, isLoading, load]);
  async function review(character: ReviewCharacter, status: string) {
    if (!canReview || busy) return;
    setBusy(character.id);
    try {const response = await fetch(`/api/moderation/characters/${character.id}`, {method: 'PUT', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({status, reason: reasons[character.id] || '', updatedAt: character.updatedAt})}); const data = await response.json(); if (!response.ok) throw Error(data.error); await load();}
    catch (value) {setError((value as Error).message);} finally {setBusy('');}
  }
  return <main className="mx-auto max-w-3xl space-y-4 p-4"><h1 className="text-xl font-bold">角色审核</h1>
    {error && <p role="alert" className="text-red-400">{error}</p>}<button className="min-h-11 rounded-lg border px-4" onClick={() => void load()} disabled={!token || !!busy}>刷新列表</button>
    {canReview && token && <BulkCharacterReview selected={characters.filter(character => selected[character.id])} token={token} disabled={loading || !!busy} onStart={() => setBusy("batch")} onFinish={() => setBusy("")} onSaved={() => load()} />}
    {loading ? <p role="status">正在加载…</p> : !error && !characters.length ? <p>暂无待处理角色。</p> : characters.map(character => <CharacterReviewCard key={character.id} character={character} reason={reasons[character.id] || ''} onReason={value => setReasons(previous => ({...previous, [character.id]: value}))} onReview={status => void review(character, status)} canReview={canReview} busy={!!busy} selected={!!selected[character.id]} onSelect={value => setSelected(previous => ({...previous, [character.id]: value}))} />)}
    <CommunityModeration />
  </main>;
}
