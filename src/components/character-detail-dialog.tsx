'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  X, Heart, Bookmark, Flag, MessageSquare, Gift, ChevronLeft, ChevronRight,
  Coins, Check, Users, Sparkles,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { loginWithNext } from '@/lib/next-path';
import { compactNumber } from '@/lib/i18n';
import { ReportDialog } from './report-dialog';
import { CharacterComments } from './character-comments';
import { SceneHeader } from '@/components/stories/scene-header';
import { getSceneConfigByCharacterId } from '@/lib/stories/scene-config';
import { resolveScene } from '@/lib/stories/scene-service';

interface DetailCharacter {
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

interface Quest {
  id: string;
  title: string;
  description?: string | null;
  rewardCoins: number;
  requiredMessages:number;
  progress:number;
  isQualified:boolean;
  isCompleted: boolean;
}
interface GiftOption {id:string;code:string;name:string;description:string|null;emoji:string;coinPrice:number;}

type Tab = 'about' | 'quests' | 'cast' | 'comments';

/**
 * The character detail view the live site opens when you tap a card — the gallery, the
 * stats, like/bookmark/report, the quest list and the secondary cast — before you commit
 * to a chat. The card used to link straight into /chat, skipping all of it.
 */
export function CharacterDetailDialog({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  const { token, refreshUser } = useAuth();
  const router = useRouter();
  const [character, setCharacter] = useState<DetailCharacter | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [giftOptions,setGiftOptions]=useState<GiftOption[]>([]);
  const [tab, setTab] = useState<Tab>('about');
  const [slide, setSlide] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [pendingLike, setPendingLike] = useState(false);
  const [pendingMark, setPendingMark] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [sendingGift,setSendingGift]=useState<string|null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function requireLogin(): boolean {
    if (token) return false;
    router.push(loginWithNext());
    return true;
  }

  async function toggleLike() {
    if (requireLogin() || !character || pendingLike) return;
    setPendingLike(true);
    const method = character.viewer.hasLiked ? 'DELETE' : 'POST';
    const res = await fetch(`/api/characters/${characterId}/like`, { method, headers: authHeaders() });
    setPendingLike(false);
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    setCharacter((c) =>
      c
        ? {
            ...c,
            // Trust the server's count rather than incrementing locally — liking is
            // idempotent, so a repeated tap must not drift the number.
            likeCount: typeof body.likeCount === 'number' ? body.likeCount : c.likeCount,
            viewer: { ...c.viewer, hasLiked: method === 'POST' },
          }
        : c,
    );
  }

  async function toggleBookmark() {
    if (requireLogin() || !character || pendingMark) return;
    setPendingMark(true);
    const method = character.viewer.hasBookmarked ? 'DELETE' : 'POST';
    const res = await fetch(`/api/characters/${characterId}/bookmark`, { method, headers: authHeaders() });
    setPendingMark(false);
    if (!res.ok) return;
    setCharacter((c) => (c ? { ...c, viewer: { ...c.viewer, hasBookmarked: method === 'POST' } } : c));
    setNotice(method === 'POST' ? "已收藏" : "已取消收藏");
  }

  async function claimQuest(questId: string) {
    if (requireLogin() || claiming) return;
    setClaiming(questId);
    const res = await fetch(`/api/characters/${characterId}/quests/${questId}/complete`, {
      method: 'POST',
      headers: authHeaders(),
    });
    setClaiming(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(body.error === 'Quest already completed' ? "该任务奖励已经领取" : body.error==='Quest condition not met'?`还需发送 ${Math.max(0,(body.target??0)-(body.progress??0))} 条消息` : "领取奖励失败");
      return;
    }
    setQuests((qs) => qs.map((q) => (q.id === questId ? { ...q, isCompleted: true } : q)));
    setNotice("获得" + (body.coinsEarned) + "金币");
  }

  async function sendGift(gift:GiftOption){
    if(requireLogin()||sendingGift)return;setSendingGift(gift.id);setError('');
    try{const response=await fetch(`/api/characters/${characterId}/gift`,{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({giftId:gift.id,amount:gift.coinPrice})});const body=await response.json();if(!response.ok)throw Error(body.error||'赠送失败');setCharacter(current=>current?{...current,giftCount:current.giftCount+1}:current);setNotice(`已赠送${gift.name}，消耗 ${body.coinPrice} 金币`);await refreshUser();}
    catch(e){setNotice(e instanceof Error?e.message:'赠送礼物失败。');}
    finally{setSendingGift(null);}
  }

  function startChat(newChat = false) {
    if (requireLogin()) return;
    router.push(`/chat?character=${characterId}${newChat ? '&new=1' : ''}`);
  }

  if (error) {
    return (
      <Overlay onClose={onClose}>
        <div className="p-8 text-center text-zinc-400">{error}</div>
      </Overlay>
    );
  }

  if (!character) {
    return (
      <Overlay onClose={onClose}>
        <div className="flex h-64 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
        </div>
      </Overlay>
    );
  }

  const gallery = character.images.length > 0
    ? character.images.map((i) => i.url)
    : character.avatarUrl
      ? [character.avatarUrl]
      : [];
  const tags = (character.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const creatorName = character.creator?.displayName || character.creator?.username;
  const openQuests = quests.filter((q) => !q.isCompleted).length;
  const sceneConfig = character ? getSceneConfigByCharacterId(character.id) : undefined;
  const sceneResolution = character ? resolveScene(character, sceneConfig) : undefined;
  const availableScene = sceneResolution?.kind === 'available' ? sceneResolution.scene : undefined;

  return (
    <>
      <Overlay onClose={onClose}>
        <div className="relative">
          {/* Gallery */}
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-950 tablet:aspect-[16/9]">
            {gallery[slide] ? (
              <img src={gallery[slide]} alt={character.name} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-linear-to-br/srgb from-purple-900/40 to-zinc-900" />
            )}
            <div className="absolute inset-0 bg-linear-to-t/srgb from-zinc-900 via-zinc-900/20 to-transparent" />

            {gallery.length > 1 && (
              <>
                <GalleryArrow side="left" onClick={() => setSlide((s) => (s - 1 + gallery.length) % gallery.length)} />
                <GalleryArrow side="right" onClick={() => setSlide((s) => (s + 1) % gallery.length)} />
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                  {gallery.map((url, i) => (
                    <button
                      key={url}
                      onClick={() => setSlide(i)}
                      aria-label={"图片 " + (i + 1)}
                      className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`}
                    />
                  ))}
                </div>
              </>
            )}

            {character.isAdult && (
              <span className="absolute left-3 top-3 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-black">
                18+
              </span>
            )}
            <button
              onClick={onClose}
              aria-label={"关闭"}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 pb-5">
            <h2 className="text-xl font-bold text-white">{character.name}</h2>
            {character.tagline && (
              <p className="mt-1 text-sm text-zinc-400">{character.tagline}</p>
            )}

            {creatorName && character.creator && (
              <Link
                href={`/profile/${encodeURIComponent(character.creator.username)}`}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
              >
                {character.creator.avatarUrl ? (
                  <img src={character.creator.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : null}
                <span>@{character.creator.username}</span>
              </Link>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
              <Stat icon={<MessageSquare className="h-3.5 w-3.5" />} value={character.chatCount} label={"聊天"} />
              <Stat icon={<Heart className="h-3.5 w-3.5" />} value={character.likeCount} label={"点赞"} />
              <Stat icon={<Gift className="h-3.5 w-3.5" />} value={character.giftCount} label={"礼物"} />
            </div>

            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] text-zinc-300">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => startChat(false)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-gradient py-3 text-sm font-bold text-white transition-opacity hover:opacity-90"
              >
                <MessageSquare className="h-4 w-4" />
                {availableScene ? "进入场景" : "开始聊天"}</button>
              <button
                onClick={() => startChat(true)}
                className="rounded-full border border-white/15 px-4 text-sm font-bold text-zinc-200 hover:bg-white/5"
              >
                {"新建聊天"}</button>
            </div>

            <div className="mt-2 flex gap-2">
              <IconAction
                active={character.viewer.hasLiked}
                onClick={toggleLike}
                icon={<Heart className={`h-4 w-4 ${character.viewer.hasLiked ? 'fill-current' : ''}`} />}
                label={character.viewer.hasLiked ? "已点赞" : "点赞"}
              />
              <IconAction
                active={character.viewer.hasBookmarked}
                onClick={toggleBookmark}
                icon={<Bookmark className={`h-4 w-4 ${character.viewer.hasBookmarked ? 'fill-current' : ''}`} />}
                label={character.viewer.hasBookmarked ? "已收藏" : "保存"}
              />
              <IconAction onClick={() => setReporting(true)} icon={<Flag className="h-4 w-4" />} label={"举报"} />
            </div>

            {notice && <p className="mt-2 text-xs text-emerald-400">{notice}</p>}

            {/* Tabs */}
            <div className="mt-5 flex gap-1 border-b border-white/10">
              <TabButton active={tab === 'about'} onClick={() => setTab('about')}>
                {"介绍"}</TabButton>
              <TabButton active={tab === 'quests'} onClick={() => setTab('quests')}>
                {"任务"}{quests.length > 0 ? ` (${quests.length})` : ''}
                {openQuests > 0 && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-brand-strong" />}
              </TabButton>
              {character.supportCast.length > 0 && (
                <TabButton active={tab === 'cast'} onClick={() => setTab('cast')}>
                  {"配角（"}{character.supportCast.length})
                </TabButton>
              )}
              <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>
                {"评论"}</TabButton>
            </div>

            <div className="pt-4">
              {tab === 'about' && (
                <div className="space-y-4">
                  {availableScene && <SceneHeader scene={availableScene} character={character} />}
                  <Section title={"个性"}>{character.personality}</Section>
                  {character.scenario && <Section title={"场景"}>{character.scenario}</Section>}
                  {character.copyrightStatement && <Section title="版权声明">{character.copyrightStatement}</Section>}
                  {character.background && <Section title={"故事"}>{character.background}</Section>}
                  {giftOptions.length>0&&<section className="space-y-2"><h3 className="text-xs font-bold text-zinc-500">赠送礼物</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{giftOptions.map(gift=><button key={gift.id} onClick={()=>void sendGift(gift)} disabled={!token||!!sendingGift} className="flex min-h-14 items-center gap-2 rounded-xl border border-white/10 bg-zinc-800/50 px-3 text-left hover:border-brand-strong/50 disabled:opacity-50"><span className="text-xl">{gift.emoji}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{gift.name}</span><span className="text-xs text-amber-400">{gift.coinPrice} 金币</span></span></button>)}</div>{!token&&<p className="text-xs text-zinc-500">登录后可赠送礼物</p>}</section>}
                  {character.greeting && <Section title={"开场白"}>{character.greeting}</Section>}
                  {character.emojis.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-bold text-zinc-500">{"情绪"}</p>
                      <div className="flex flex-wrap gap-2">
                        {character.emojis.map((e) => (
                          <div key={e.id} className="flex flex-col items-center gap-1">
                            <img src={e.url} alt={e.emotion} className="h-14 w-14 rounded-xl object-cover" />
                            <span className="text-[10px] text-zinc-400">{e.emotion}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'quests' && (
                <div className="space-y-2">
                  {quests.length === 0 ? (
                    <p className="py-6 text-center text-sm text-zinc-500">
                      {"该角色暂无任务"}</p>
                  ) : (
                    quests.map((q) => (
                      <div
                        key={q.id}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-800/50 p-3"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            q.isCompleted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand-strong/15 text-brand-strong'
                          }`}
                        >
                          {q.isCompleted ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">{q.title}</p>
                          {q.description && (
                            <p className="truncate text-xs text-zinc-500">{q.description}</p>
                          )}
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-400">
                            <Coins className="h-3 w-3" />
                            {q.rewardCoins}
                          </p>
                          {!q.isCompleted&&<p className="mt-0.5 text-[11px] text-zinc-500">消息进度 {q.progress}/{q.requiredMessages}</p>}
                        </div>
                        <button
                          onClick={() => claimQuest(q.id)}
                          disabled={q.isCompleted || !q.isQualified || claiming === q.id}
                          className="shrink-0 rounded-full bg-zinc-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-600 disabled:opacity-40"
                        >
                          {q.isCompleted ? "已领取" : claiming === q.id ? '...' : q.isQualified?"领取奖励":'尚未达成'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === 'comments' && <CharacterComments characterId={characterId} />}

              {tab === 'cast' && (
                <div className="grid grid-cols-2 gap-3">
                  {character.supportCast.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-zinc-800/50 p-2.5">
                      {s.avatarUrl ? (
                        <img src={s.avatarUrl} alt={s.name} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700">
                          <Users className="h-4 w-4 text-zinc-400" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white">{s.name}</p>
                        {s.description && (
                          <p className="truncate text-[11px] text-zinc-500">{s.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Overlay>

      {reporting && (
        <ReportDialog
          targetType="CHARACTER"
          targetId={characterId}
          targetName={character.name}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-0 tablet:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto bg-zinc-900 tablet:max-h-[92vh] tablet:rounded-3xl tablet:border tablet:border-white/10"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

function GalleryArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? "上一张图片" : "下一张图片"}
      className={`absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 ${
        side === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1" title={label}>
      {icon}
      {compactNumber(value)}
    </span>
  );
}

function IconAction({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-xs font-bold transition-colors ${
        active
          ? 'border-brand-strong/50 bg-brand-strong/10 text-brand-strong'
          : 'border-white/10 text-zinc-300 hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3 pb-2 text-sm font-bold transition-colors ${
        active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-white" />}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-zinc-500">{title}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{children}</p>
    </div>
  );
}
