'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Heart, Flag, MessageSquare, Gift,
} from 'lucide-react';
import { useAuth } from '@web/lib/auth-context';
import { loginWithNext } from '@web/lib/next-path';
import { ReportDialog } from '@/components/moderation/report-dialog';
import { DesignIcon } from '@/components/primitives/design-icon';
import { CharacterComments } from './character-comments';
import { getSceneConfigByCharacterId } from '@rumiai/contracts/stories/scene-config';
import { resolveScene } from '@rumiai/contracts/stories/scene-service';
import { Overlay, GalleryArrow, Stat, IconAction, TabButton } from './character-detail-parts';
import { AboutTab, QuestsTab, CastTab } from './character-detail-tabs';
import { useCharacterDetail } from './use-character-detail';
import { CharacterReplyPlan } from './character-reply-plan';
import { CharacterVisual, resolveCharacterVisual } from './character-visual';

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

  const { retry, character, quests, giftOptions, pendingLike, pendingMark, claiming, sendingGift, notice, error, toggleLike, toggleBookmark, claimQuest, sendGift } = useCharacterDetail(characterId, requireLogin);


  function startChat(newChat = false) {
    const scene = availableScene ? '&scene=1' : '';
    const target = `/chat?character=${encodeURIComponent(characterId)}${scene}${newChat ? '&new=1' : ''}`;
    router.push(token ? target : loginWithNext(target));
  }

  if (error) {
    return (
      <Overlay onClose={onClose}>
        <div className="p-6"><h2 className="text-lg font-semibold">角色暂时无法查看</h2><p role="alert" className="mt-2 text-sm text-muted-foreground">{error}</p><div className="mt-4 flex gap-3"><button type="button" onClick={retry} className="min-h-11 rounded-full bg-primary px-4 text-sm text-primary-foreground">重新加载</button><button type="button" onClick={onClose} className="min-h-11 rounded-full border border-border px-4 text-sm">关闭</button></div></div>
      </Overlay>
    );
  }

  if (!character) {
    return (
      <Overlay onClose={onClose}>
        <div className="flex h-64 items-center justify-center">
          <div role="status" className="text-center"><span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary"/><p className="mt-3 text-sm text-muted-foreground">正在读取角色…</p><button type="button" onClick={onClose} className="mt-3 min-h-11 px-4 text-sm text-primary">关闭</button></div>
        </div>
      </Overlay>
    );
  }

  const fallbackVisual = resolveCharacterVisual({ id: character.id, avatarUrl: character.avatarUrl });
  const gallery = character.images.length > 0 ? character.images.map((image) => image.url) : fallbackVisual ? [fallbackVisual] : [];
  const tags = (character.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const creatorName = character.creator?.displayName || character.creator?.username;
  const openQuests = quests.filter((q) => !q.isCompleted).length;
  const sceneConfig = getSceneConfigByCharacterId(character.id);
  const sceneResolution = resolveScene(character, sceneConfig);
  const availableScene = sceneResolution.kind === 'available' ? sceneResolution.scene : undefined;

  return (
    <>
      <Overlay onClose={onClose}>
        <div className="relative bg-background text-foreground">
          {/* Gallery */}
          <div className="relative h-[380px] w-full overflow-hidden bg-muted sm:h-[420px]">
            {gallery[slide] ? (
              <CharacterVisual id={character.id} imageUrl={gallery[slide]} alt={character.name} sizes="(max-width: 768px) 100vw, 768px" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-linear-to-br/srgb from-purple-900/40 to-zinc-900" />
            )}
            <div className="absolute inset-0 bg-linear-to-t/srgb from-black/80 via-black/10 to-transparent" />

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
              <span className="absolute right-3 top-3 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-black">
                18+
              </span>
            )}
            <button
              onClick={onClose}
              aria-label={"返回角色列表"}
              className="absolute left-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-background/95 text-foreground hover:bg-background"
            >
              <DesignIcon name="ph:arrow-left" size={20}/>
            </button>
            <div className="absolute inset-x-0 bottom-0 p-5 text-white"><span className="inline-flex rounded-full bg-white/20 px-2.5 py-1 text-xs">AI角色</span><h2 id="character-dialog-title" className="mt-2 text-[28px] font-bold leading-tight">{character.name}</h2>{character.tagline && <p className="mt-1 text-sm text-white/90">{character.tagline}</p>}{creatorName && <p className="mt-2 text-xs text-white/80">创作者 · {creatorName}</p>}</div>
          </div>

          <div className="px-4 pb-6 pt-4 sm:px-5">
            {creatorName && character.creator && (
              <Link
                href={`/profile/${encodeURIComponent(character.creator.username)}`}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
              >
                {character.creator.avatarUrl ? (
                  <img src={character.creator.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : null}
                <span>@{character.creator.username}</span>
              </Link>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Stat icon={<MessageSquare className="h-3.5 w-3.5" />} value={character.chatCount} label={"聊天"} />
              <Stat icon={<Heart className="h-3.5 w-3.5" />} value={character.likeCount} label={"点赞"} />
              <Stat icon={<Gift className="h-3.5 w-3.5" />} value={character.giftCount} label={"礼物"} />
            </div>

            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-2 flex gap-2">
              <IconAction
                active={character.viewer.hasLiked}
                onClick={toggleLike}
                disabled={pendingLike}
                icon={<DesignIcon name="ph:heart" size={16} />}
                label={character.viewer.hasLiked ? "已点赞" : "点赞"}
              />
              <IconAction
                active={character.viewer.hasBookmarked}
                onClick={toggleBookmark}
                disabled={pendingMark}
                icon={<DesignIcon name="ph:star" size={16} />}
                label={character.viewer.hasBookmarked ? "已收藏" : "保存"}
              />
              <IconAction onClick={() => setReporting(true)} icon={<Flag className="h-4 w-4" />} label={"举报"} />
            </div>

            {notice && <p role="status" className="mt-3 rounded-xl bg-primary/8 p-3 text-sm text-foreground">{notice}</p>}

            {/* Tabs */}
            <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border">
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

            <div id="character-about-content" className="pt-4">
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
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-sm">
            {giftOptions.length > 0 && <button type="button" onClick={() => { setTab('about'); requestAnimationFrame(() => document.getElementById('character-gifts')?.scrollIntoView({block:'center'})); }} className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-border px-4 text-sm"><DesignIcon name="ph:gift" size={20}/>送礼</button>}
            <button type="button" onClick={() => startChat(false)} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"><DesignIcon name="ph:chat-circle-text-fill" size={20}/>{availableScene ? '进入场景' : '开始聊天'}</button>
            <button type="button" onClick={() => startChat(true)} className="min-h-12 rounded-full border border-border px-3 text-xs font-medium">新建聊天</button>
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
