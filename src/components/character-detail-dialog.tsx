'use client';
import { zhText } from '@/lib/zh-text';

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
  isCompleted: boolean;
}

type Tab = 'about' | 'quests' | 'cast' | 'comments';

/**
 * The character detail view the live site opens when you tap a card — the gallery, the
 * stats, like/bookmark/report, the quest list and the secondary cast — before you commit
 * to a chat. The card used to link straight into /chat, skipping all of it.
 */
export function CharacterDetailDialog({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  const { token } = useAuth();
  const router = useRouter();
  const [character, setCharacter] = useState<DetailCharacter | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [tab, setTab] = useState<Tab>('about');
  const [slide, setSlide] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [pendingLike, setPendingLike] = useState(false);
  const [pendingMark, setPendingMark] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
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
    ])
      .then(([detail, questList]) => {
        if (!alive) return;
        if (detail?.character) setCharacter(detail.character);
        else setError(zhText("โหลดข้อมูลตัวละครไม่สำเร็จ"));
        if (Array.isArray(questList)) setQuests(questList);
      })
      .catch(() => alive && setError(zhText("โหลดข้อมูลตัวละครไม่สำเร็จ")));
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
    setNotice(method === 'POST' ? zhText("บันทึกไว้แล้ว") : zhText("เอาออกจากที่บันทึกแล้ว"));
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
      setNotice(body.error === 'Quest already completed' ? zhText("ภารกิจนี้รับรางวัลไปแล้ว") : zhText("รับรางวัลไม่สำเร็จ"));
      return;
    }
    setQuests((qs) => qs.map((q) => (q.id === questId ? { ...q, isCompleted: true } : q)));
    setNotice(zhText("ได้รับ") + (body.coinsEarned) + zhText("คอยน์"));
  }

  function startChat(newChat = false) {
    if (requireLogin()) return;
    router.push(`/chat?character=${characterId}${newChat ? '&new=1' : ''}`);
  }

  if (error) {
    return (
      <Overlay onClose={onClose}>
        <div className="p-8 text-center font-athiti text-zinc-400">{error}</div>
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

  return (
    <>
      <Overlay onClose={onClose}>
        <div className="relative">
          {/* Gallery */}
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-950 tablet:aspect-[16/9]">
            {gallery[slide] ? (
              <img src={gallery[slide]} alt={character.name} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-purple-900/40 to-zinc-900" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/20 to-transparent" />

            {gallery.length > 1 && (
              <>
                <GalleryArrow side="left" onClick={() => setSlide((s) => (s - 1 + gallery.length) % gallery.length)} />
                <GalleryArrow side="right" onClick={() => setSlide((s) => (s + 1) % gallery.length)} />
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                  {gallery.map((url, i) => (
                    <button
                      key={url}
                      onClick={() => setSlide(i)}
                      aria-label={zhText("รูปที่") + (i + 1) + zhText("")}
                      className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`}
                    />
                  ))}
                </div>
              </>
            )}

            {character.isAdult && (
              <span className="absolute left-3 top-3 rounded-full bg-amber-500/90 px-2 py-0.5 font-barlow text-[10px] font-bold text-black">
                18+
              </span>
            )}
            <button
              onClick={onClose}
              aria-label={zhText("ปิด")}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 pb-5">
            <h2 className="font-athiti text-xl font-bold text-white">{character.name}</h2>
            {character.tagline && (
              <p className="mt-1 font-athiti text-sm text-zinc-400">{character.tagline}</p>
            )}

            {creatorName && character.creator && (
              <Link
                href={`/profile/${encodeURIComponent(character.creator.username)}`}
                className="mt-2 inline-flex items-center gap-1.5 font-barlow text-xs text-zinc-400 hover:text-white"
              >
                {character.creator.avatarUrl ? (
                  <img src={character.creator.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : null}
                <span>@{character.creator.username}</span>
              </Link>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 font-barlow text-xs text-zinc-400">
              <Stat icon={<MessageSquare className="h-3.5 w-3.5" />} value={character.chatCount} label={zhText("แชท")} />
              <Stat icon={<Heart className="h-3.5 w-3.5" />} value={character.likeCount} label={zhText("ไลก์")} />
              <Stat icon={<Gift className="h-3.5 w-3.5" />} value={character.giftCount} label={zhText("ของขวัญ")} />
            </div>

            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="rounded-full bg-zinc-800 px-2.5 py-0.5 font-athiti text-[11px] text-zinc-300">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => startChat(false)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[#EE4036] to-[#FAAF40] py-3 font-athiti text-sm font-bold text-white transition-opacity hover:opacity-90"
              >
                <MessageSquare className="h-4 w-4" />
                {zhText("เริ่มคุย")}</button>
              <button
                onClick={() => startChat(true)}
                className="rounded-full border border-white/15 px-4 font-athiti text-sm font-bold text-zinc-200 hover:bg-white/5"
              >
                {zhText("แชทใหม่")}</button>
            </div>

            <div className="mt-2 flex gap-2">
              <IconAction
                active={character.viewer.hasLiked}
                onClick={toggleLike}
                icon={<Heart className={`h-4 w-4 ${character.viewer.hasLiked ? 'fill-current' : ''}`} />}
                label={character.viewer.hasLiked ? zhText("ถูกใจแล้ว") : zhText("ถูกใจ")}
              />
              <IconAction
                active={character.viewer.hasBookmarked}
                onClick={toggleBookmark}
                icon={<Bookmark className={`h-4 w-4 ${character.viewer.hasBookmarked ? 'fill-current' : ''}`} />}
                label={character.viewer.hasBookmarked ? zhText("บันทึกแล้ว") : zhText("บันทึก")}
              />
              <IconAction onClick={() => setReporting(true)} icon={<Flag className="h-4 w-4" />} label={zhText("รายงาน")} />
            </div>

            {notice && <p className="mt-2 font-athiti text-xs text-emerald-400">{notice}</p>}

            {/* Tabs */}
            <div className="mt-5 flex gap-1 border-b border-white/10">
              <TabButton active={tab === 'about'} onClick={() => setTab('about')}>
                {zhText("เกี่ยวกับ")}</TabButton>
              <TabButton active={tab === 'quests'} onClick={() => setTab('quests')}>
                {zhText("ภารกิจ")}{quests.length > 0 ? ` (${quests.length})` : ''}
                {openQuests > 0 && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#F2572B]" />}
              </TabButton>
              {character.supportCast.length > 0 && (
                <TabButton active={tab === 'cast'} onClick={() => setTab('cast')}>
                  {zhText("ตัวละครร่วม (")}{character.supportCast.length})
                </TabButton>
              )}
              <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>
                {zhText("คอมเมนต์")}</TabButton>
            </div>

            <div className="pt-4">
              {tab === 'about' && (
                <div className="space-y-4">
                  <Section title={zhText("บุคลิก")}>{character.personality}</Section>
                  {character.scenario && <Section title={zhText("สถานการณ์")}>{character.scenario}</Section>}
                  {character.copyrightStatement && <Section title="版权声明">{character.copyrightStatement}</Section>}
                  {character.background && <Section title={zhText("เรื่องราว")}>{character.background}</Section>}
                  {character.greeting && <Section title={zhText("คำทักทาย")}>{character.greeting}</Section>}
                  {character.emojis.length > 0 && (
                    <div>
                      <p className="mb-2 font-athiti text-xs font-bold text-zinc-500">{zhText("อารมณ์")}</p>
                      <div className="flex flex-wrap gap-2">
                        {character.emojis.map((e) => (
                          <div key={e.id} className="flex flex-col items-center gap-1">
                            <img src={e.url} alt={e.emotion} className="h-14 w-14 rounded-xl object-cover" />
                            <span className="font-athiti text-[10px] text-zinc-400">{e.emotion}</span>
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
                    <p className="py-6 text-center font-athiti text-sm text-zinc-500">
                      {zhText("ตัวละครนี้ยังไม่มีภารกิจ")}</p>
                  ) : (
                    quests.map((q) => (
                      <div
                        key={q.id}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-800/50 p-3"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            q.isCompleted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#F2572B]/15 text-[#F2572B]'
                          }`}
                        >
                          {q.isCompleted ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-athiti text-sm font-semibold text-white">{q.title}</p>
                          {q.description && (
                            <p className="truncate font-athiti text-xs text-zinc-500">{q.description}</p>
                          )}
                          <p className="mt-0.5 flex items-center gap-1 font-barlow text-[11px] text-amber-400">
                            <Coins className="h-3 w-3" />
                            {q.rewardCoins}
                          </p>
                        </div>
                        <button
                          onClick={() => claimQuest(q.id)}
                          disabled={q.isCompleted || claiming === q.id}
                          className="shrink-0 rounded-full bg-zinc-700 px-3 py-1.5 font-athiti text-xs font-bold text-white hover:bg-zinc-600 disabled:opacity-40"
                        >
                          {q.isCompleted ? zhText("รับแล้ว") : claiming === q.id ? '...' : zhText("รับรางวัล")}
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
                        <p className="truncate font-athiti text-sm text-white">{s.name}</p>
                        {s.description && (
                          <p className="truncate font-athiti text-[11px] text-zinc-500">{s.description}</p>
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
      aria-label={side === 'left' ? zhText("รูปก่อนหน้า") : zhText("รูปถัดไป")}
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
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 font-athiti text-xs font-bold transition-colors ${
        active
          ? 'border-[#F2572B]/50 bg-[#F2572B]/10 text-[#F2572B]'
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
      className={`relative px-3 pb-2 font-athiti text-sm font-bold transition-colors ${
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
      <p className="mb-1 font-athiti text-xs font-bold text-zinc-500">{title}</p>
      <p className="whitespace-pre-wrap font-athiti text-sm leading-relaxed text-zinc-300">{children}</p>
    </div>
  );
}
