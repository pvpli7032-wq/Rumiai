'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@web/lib/auth-context';

export interface DetailCharacter {
  id: string;
  name: string;
  tagline?: string | null;
  personality: string;
  background?: string | null;
  copyrightStatement?: string | null;
  greeting?: string | null;
  scenario?: string | null;
  roleTemplate?: string | null;
  avatarUrl?: string | null;
  chatCount: number;
  likeCount: number;
  messageCount: number;
  giftCount: number;
  isAdult: boolean;
  relationshipStatus?: string | null;
  tags?: string | null;
  creator?: { id: string; username: string; displayName?: string | null; avatarUrl?: string | null } | null;
  images: Array<{ id: string; url: string }>;
  emojis: Array<{ id: string; emotion: string; url: string }>;
  supportCast: Array<{ id: string; name: string; avatarUrl?: string | null; description?: string | null }>;
  viewer: { hasLiked: boolean; hasBookmarked: boolean };
}

export interface Quest {
  id: string;
  title: string;
  description?: string | null;
  rewardCoins: number;
  requiredMessages:number;
  progress:number;
  isQualified:boolean;
  isCompleted: boolean;
}
export interface GiftOption {id:string;code:string;name:string;description:string|null;emoji:string;coinPrice:number;}

/**
 * 角色详情的数据层：详情、任务、礼物目录，以及点赞/收藏/领奖/送礼四个写操作。
 * 渲染在 character-detail-dialog.tsx 与 character-detail-tabs.tsx。
 */
export function useCharacterDetail(characterId: string, requireLogin: () => boolean) {
  const { token, refreshUser } = useAuth();
  const [character, setCharacter] = useState<DetailCharacter | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [giftOptions,setGiftOptions]=useState<GiftOption[]>([]);
  const [pendingLike, setPendingLike] = useState(false);
  const [pendingMark, setPendingMark] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [sendingGift,setSendingGift]=useState<string|null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  // State updates are asynchronous; refs close the double-tap window before React rerenders.
  const likeBusyRef = useRef(false);
  const bookmarkBusyRef = useRef(false);
  const questBusyRef = useRef(false);
  const giftBusyRef = useRef(false);

  const authHeaders = useCallback(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  useEffect(() => {
    let alive = true;
    // Both requests carry the token when there is one: the detail response includes
    // whether *this* viewer liked or bookmarked it, and the quest list includes their
    // per-quest progress. Without the header both come back in the anonymous shape.
    Promise.all([
      fetch(`/api/characters/${characterId}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/characters/${characterId}/quests`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])),
      fetch('/api/gifts').then(r=>(r.ok?r.json():{gifts:[]})).catch(()=>({gifts:[]})),
    ])
      .then(([detail, questList, giftCatalog]) => {
        if (!alive) return;
        if (detail?.character) setCharacter(detail.character);
        else setError("角色详情加载失败");
        if (Array.isArray(questList)) setQuests(questList);
        if(Array.isArray(giftCatalog?.gifts))setGiftOptions(giftCatalog.gifts);
      })
      .catch(() => alive && setError("角色详情加载失败"));
    return () => {
      alive = false;
    };
  }, [characterId, authHeaders]);

  async function toggleLike() {
    if (requireLogin() || !character || pendingLike || likeBusyRef.current) return;
    likeBusyRef.current = true;
    setPendingLike(true);
    const method = character.viewer.hasLiked ? 'DELETE' : 'POST';
    try {
      const res = await fetch(`/api/characters/${characterId}/like`, { method, headers: authHeaders() });
      if (!res.ok) { setNotice('点赞操作失败，请稍后重试'); return; }
      const body = await res.json().catch(() => ({}));
      setCharacter((current) => current ? { ...current, likeCount: typeof body.likeCount === 'number' ? body.likeCount : current.likeCount, viewer: { ...current.viewer, hasLiked: method === 'POST' } } : current);
    } catch { setNotice('点赞操作失败，请稍后重试'); }
    finally { likeBusyRef.current = false; setPendingLike(false); }
  }

  async function toggleBookmark() {
    if (requireLogin() || !character || pendingMark || bookmarkBusyRef.current) return;
    bookmarkBusyRef.current = true;
    setPendingMark(true);
    const method = character.viewer.hasBookmarked ? 'DELETE' : 'POST';
    try {
      const res = await fetch(`/api/characters/${characterId}/bookmark`, { method, headers: authHeaders() });
      if (!res.ok) { setNotice('收藏操作失败，请稍后重试'); return; }
      setCharacter((current) => current ? { ...current, viewer: { ...current.viewer, hasBookmarked: method === 'POST' } } : current);
      setNotice(method === 'POST' ? '已收藏' : '已取消收藏');
    } catch { setNotice('收藏操作失败，请稍后重试'); }
    finally { bookmarkBusyRef.current = false; setPendingMark(false); }
  }

  async function claimQuest(questId: string) {
    if (requireLogin() || claiming || questBusyRef.current) return;
    questBusyRef.current = true;
    setClaiming(questId);
    try {
      const res = await fetch(`/api/characters/${characterId}/quests/${questId}/complete`, { method: 'POST', headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(body.error === 'Quest already completed' ? '该任务奖励已经领取' : body.error === 'Quest condition not met' ? `还需发送 ${Math.max(0, (body.target ?? 0) - (body.progress ?? 0))} 条消息` : '领取奖励失败'); return; }
      setQuests((items) => items.map((quest) => quest.id === questId ? { ...quest, isCompleted: true } : quest));
      await refreshUser();
      setNotice(`获得${body.coinsEarned}金币`);
    } catch { setNotice('领取奖励失败'); }
    finally { questBusyRef.current = false; setClaiming(null); }
  }

  async function sendGift(gift: GiftOption) {
    if (requireLogin() || sendingGift || giftBusyRef.current) return;
    giftBusyRef.current = true;
    setSendingGift(gift.id);
    setError('');
    try {
      const response = await fetch(`/api/characters/${characterId}/gift`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ giftId: gift.id, amount: gift.coinPrice }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || '赠送失败');
      setCharacter((current) => current ? { ...current, giftCount: current.giftCount + 1 } : current);
      setNotice(`已赠送${gift.name}，消耗 ${body.coinPrice} 金币`);
      await refreshUser();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : '赠送礼物失败。'); }
    finally { giftBusyRef.current = false; setSendingGift(null); }
  }

  return { character, quests, giftOptions, pendingLike, pendingMark, claiming, sendingGift, notice, error, toggleLike, toggleBookmark, claimQuest, sendGift };
}
