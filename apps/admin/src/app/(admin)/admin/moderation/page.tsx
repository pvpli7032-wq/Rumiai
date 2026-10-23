'use client';
import {useCallback, useEffect, useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {useAdminAccess} from '@admin/components/use-admin-access';
import {BulkCharacterReview} from '@admin/components/moderation/bulk-character-review';
import {CommunityModeration} from '@admin/components/moderation/community-moderation';
import {CharacterReviewCard, type ReviewCharacter} from '@admin/components/moderation/character-review-card';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '@admin/components/admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {EmptyState} from '@rumiai/ui/empty-state';

export default function Moderation() {
  const {sessionActive, loading: accessLoading} = useAdminAccess();
  const {permissions} = useAdminAccess();
  const canReview = permissions.includes('moderation.write');
  const [characters, setCharacters] = useState<ReviewCharacter[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [reasons, setReasons] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!sessionActive) return;
    setCharacters([]); setSelected({}); setLoading(true);
    try {const response = await fetch('/api/admin/moderation/characters', {credentials: 'include', cache: 'no-store', signal}); const data = await response.json(); if (!response.ok) throw Error(data.error); if (!signal?.aborted) {setCharacters(data); setError('');}}
    catch (value) {if (!signal?.aborted) setError((value as Error).message);}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [sessionActive]);
  useEffect(() => {
    const controller = new AbortController();
    if (sessionActive) void load(controller.signal);
    else if (!accessLoading) {setCharacters([]); setLoading(false); setError('请先登录审核账号。');}
    return () => controller.abort();
  }, [sessionActive, accessLoading, load]);
  async function review(character: ReviewCharacter, status: string) {
    if (!canReview || busy) return;
    setBusy(character.id);
    try {const response = await fetch(`/api/admin/moderation/characters/${character.id}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status, reason: reasons[character.id] || '', updatedAt: character.updatedAt})}); const data = await response.json(); if (!response.ok) throw Error(data.error); await load();}
    catch (value) {setError((value as Error).message);} finally {setBusy('');}
  }
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="内容与社区"
        title="审核中心"
        description="集中处理角色审核、社区举报与申诉。每次处置都会记录操作人与理由，并写入审计。"
        actions={
          <Button variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={!sessionActive || !!busy} loading={loading} onClick={() => void load()}>刷新列表</Button>
        }
      />
      {error && <AdminNotice tone="error" title={error} />}
      {canReview && sessionActive && <BulkCharacterReview selected={characters.filter(character => selected[character.id])} sessionActive={sessionActive} disabled={loading || !!busy} onStart={() => setBusy("batch")} onFinish={() => setBusy("")} onSaved={() => load()} />}
      <AdminPanel
        title="待审角色"
        description="勾选后可交由上方「批量审核」一次性处置。"
        badge={<Badge>{characters.length}</Badge>}
      >
        {loading ? (
          <AdminNotice tone="loading" title="正在加载待审角色…" />
        ) : characters.length === 0 ? (
          <EmptyState title={error ? '暂无法加载待审列表' : '暂无待处理角色'} description={error ? undefined : '有新角色提交后会出现在这里。'} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {characters.map(character => (
              <CharacterReviewCard key={character.id} character={character} reason={reasons[character.id] || ''} onReason={value => setReasons(previous => ({...previous, [character.id]: value}))} onReview={status => void review(character, status)} canReview={canReview} busy={!!busy} selected={!!selected[character.id]} onSelect={value => setSelected(previous => ({...previous, [character.id]: value}))} />
            ))}
          </div>
        )}
      </AdminPanel>
      <CommunityModeration />
    </AdminPage>
  );
}
