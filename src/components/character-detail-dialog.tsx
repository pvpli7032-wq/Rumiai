'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  X, Heart, Bookmark, Flag, MessageSquare, Gift,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { loginWithNext } from '@/lib/next-path';
import { ReportDialog } from './report-dialog';
import { CharacterComments } from './character-comments';
import { getSceneConfigByCharacterId } from '@/lib/stories/scene-config';
import { resolveScene } from '@/lib/stories/scene-service';
import { Overlay, GalleryArrow, Stat, IconAction, TabButton } from './character-detail-parts';
import { AboutTab, QuestsTab, CastTab } from './character-detail-tabs';
import { useCharacterDetail } from './use-character-detail';
import { CharacterReplyPlan } from './character-reply-plan';

type Tab = 'about' | 'quests' | 'cast' | 'comments';

/**
 * The character detail view the live site opens when you tap a card — the gallery, the
 * stats, like/bookmark/report, the quest list and the secondary cast — before you commit
 * to a chat. The card used to link straight into /chat, skipping all of it.
 */
export function CharacterDetailDialog({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  const { token } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('about');
  const [slide, setSlide] = useState(0);
  const [reporting, setReporting] = useState(false);

  function requireLogin(): boolean {
    if (token) return false;
    router.push(loginWithNext());
    return true;
  }

  const { character, quests, giftOptions, claiming, sendingGift, notice, error, toggleLike, toggleBookmark, claimQuest, sendGift } = useCharacterDetail(characterId, requireLogin);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  const sceneConfig = getSceneConfigByCharacterId(character.id);
  const sceneResolution = resolveScene(character, sceneConfig);
  const availableScene = sceneResolution.kind === 'available' ? sceneResolution.scene : undefined;

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
                <AboutTab
                  character={character}
                  replyPlan={<CharacterReplyPlan characterId={character.id} compact />}
                  scene={availableScene}
                  giftOptions={giftOptions}
                  sendingGift={sendingGift}
                  token={token}
                  onSendGift={(gift) => void sendGift(gift)}
                />
              )}

              {tab === 'quests' && (
                <QuestsTab quests={quests} claiming={claiming} onClaim={(questId) => void claimQuest(questId)} />
              )}

              {tab === 'comments' && <CharacterComments characterId={characterId} />}

              {tab === 'cast' && <CastTab cast={character.supportCast} />}
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
