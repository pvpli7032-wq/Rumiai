'use client';
import { ChatInbox } from '@/components/chat-inbox';
import { StoryMode } from '@/components/chat/story-mode';
import { ConversationTools } from '@/components/conversation-tools';
import { zhError } from '@/lib/copy/zh';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { readNumber, useUiConfig } from '@/lib/settings/use-ui-config';
import { loginWithNext } from '@/lib/next-path';
import { RelationshipPanel } from '@/components/chat/relationship-panel';
import { MemoryPanel } from '@/components/chat/memory-panel';
import { ReportDialog } from '@/components/report-dialog';
import { RoleplayText } from '@/components/chat/roleplay-text';
import { MessageActions } from '@/components/chat/message-actions';
import { spokenText } from '@/lib/rp-markup';
import { speak, stopSpeaking } from '@/lib/speech';
import { parseShortcuts, parseBannedWords, containsBannedWord, type Shortcut } from '@/lib/preferences';
import { HiddenReply } from '@/components/chat/hidden-reply';
import { ActionSuggestions } from '@/components/chat/action-suggestions';
import { QuotaBar } from '@/components/chat/quota-bar';
import { StreamCancelRow } from '@/components/chat/stream-cancel';
import { useQuota } from '@/lib/hooks/use-quota';
import { ChapterClose } from '@/components/stories/chapter-close';
import { EndChapterDialog } from '@/components/stories/end-chapter-dialog';
import { getSceneConfigByCharacterId } from '@/lib/stories/scene-config';
import { resolveScene } from '@/lib/stories/scene-service';
import { buildChapterCloseData } from '@/lib/stories/chapter-close';
import { trackSceneFunnelEvent } from '@/lib/analytics/scene-funnel-client';
import { notifyChatListChanged } from '@/lib/conversations/chat-events';
import { Send, Loader2, ArrowLeft, Flag } from 'lucide-react';
import type {ChatMessage as Message} from '@/lib/api-types/conversations';
import {fetchEarlierMessagePage, fetchLatestMessagePage, refetchPageSize} from '@/lib/conversations/message-history-client';
import Link from 'next/link';
import {consumeChatStream, newRequestId, queryTurn} from './turn-request';


interface Character { id: string; name: string; personality: string; background: string; greeting?: string | null; avatarUrl?: string | null; }

const EMOJI_LIST = ['🌸', '⚡', '🔮', '🌙', '✨', '💫', '🦋', '🌺', '🐉', '🦊'];

/**
 * Fallback badge for the handful of characters with no picture. Derived from the id
 * so a character keeps the same emoji — an incrementing counter used to hand out
 * whichever emoji came next, so it changed with load order.
 */
function getCharEmoji(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 1000003;
  return EMOJI_LIST[hash % EMOJI_LIST.length];
}

/**
 * The character's picture, matching what the discover cards show. This page used to
 * render only the emoji badge and never touched avatarUrl, so every character
 * appeared as an anonymous gradient circle once you opened the chat.
 */
function CharacterAvatar({
  character,
  size,
  className = '',
}: {
  character: Pick<Character, 'id' | 'name' | 'avatarUrl'>;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (character.avatarUrl && !failed) {
    return (
      <img
        src={character.avatarUrl}
        alt={character.name}
        style={box}
        draggable={false}
        onError={() => setFailed(true)}
        className={`rounded-full object-cover bg-zinc-800 shadow-lg shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      style={{ ...box, fontSize: Math.round(size * 0.5) }}
      className={`rounded-full bg-linear-to-br/srgb from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shrink-0 ${className}`}
    >
      {getCharEmoji(character.id)}
    </div>
  );
}

function ChatRouteContent() {
  const searchParams = useSearchParams();
  const storyRunId = searchParams.get('storyRun');
  if (storyRunId) return <StoryMode runId={storyRunId} />;
  return <ChatContent />;
}

function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();
  // 单条消息上限取设置中心下发值；未加载时省略约束，服务端仍按配置校验。
  const chatMaxChars = readNumber(useUiConfig(), 'chat.maxMessageChars');
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [endChapterDialogOpen, setEndChapterDialogOpen] = useState(false);
  const [showChapterClose, setShowChapterClose] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const activeRequest=useRef<AbortController|null>(null);
  // 一次点击一个请求号（V3 §20）：同一条草稿重试沿用同一个编号，成功后清空。
  const pendingSend = useRef<{requestId: string; content: string} | null>(null);
  // 重新生成同理：同一个消息被连点重试时沿用同一个编号。
  const pendingRegen = useRef<{messageId: string; requestId: string} | null>(null);
  function startRequest(){activeRequest.current?.abort();const controller=new AbortController();activeRequest.current=controller;return controller.signal;}
  const [chatError, setChatError] = useState<string | null>(null);
  const [mockNotice, setMockNotice] = useState(false);
  // 额度行与取消计费提示（V3 表 15/16）：数值只来自 /api/me/quota 与 SSE 的 cost 事件。
  const {quota, loading: quotaLoading, error: quotaError, reload: reloadQuota, applyCost} = useQuota(token);
  const [insufficientNotice, setInsufficientNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  // 历史分页：cursor 指向本页最早一条，hasEarlier 决定是否显示"加载更早"。
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const skipAutoScrollRef = useRef(false);
  const [reporting, setReporting] = useState(false);
  const [reportingMessage,setReportingMessage]=useState<string|null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Reader preferences. readingMode enlarges the prose, bannedWords hides a reply behind a
  // tap rather than deleting it, and shortcuts fill the composer.
  const readingMode = Boolean(user?.readingMode);
  const bannedWords = parseBannedWords(user?.bannedWords);
  const shortcuts: Shortcut[] = parseShortcuts(user?.shortcuts);
  const requestedConversation = searchParams.get('conversation');
  const [resolvedCharId,setResolvedCharId] = useState<string|null>(null);
  const charId = searchParams.get('character') || resolvedCharId;
  const requestedScene = searchParams.get('scene') === '1';
  const sceneConfig = requestedScene && charId ? getSceneConfigByCharacterId(charId) : undefined;
  const sceneResolution = requestedScene && character ? resolveScene(character, sceneConfig) : undefined;
  const activeScene = sceneResolution?.kind === 'available' ? sceneResolution.scene : undefined;
  useEffect(()=>{setStreaming(false);setStreamingText('');setBusyId(null);return()=>{activeRequest.current?.abort();};},[charId,requestedConversation,conversationId]);
  useEffect(()=>{setResolvedCharId(null);if(!requestedConversation)return;if(!token){if(!authLoading)router.push(loginWithNext());return;}fetch('/api/conversations/'+encodeURIComponent(requestedConversation),{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(data=>setResolvedCharId(data.conversation.character.id)).catch(()=>{setChatError('无法打开该对话，请返回聊天列表。');setLoading(false)});},[requestedConversation,token,authLoading,router]);
  // "新建聊天" on the detail dialog asks for a fresh room instead of reopening the last one.
  const wantsNewChat = searchParams.get('new') === '1';

  useEffect(() => {
    // 加载更早的历史时不能滚到底部，否则用户刚翻上去就被弹回来。
    if (skipAutoScrollRef.current) { skipAutoScrollRef.current = false; return; }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    if (!charId) { setLoading(false); return; }
    // The provider restores the token from localStorage in its own effect, so on the
    // first pass token is still null even for a signed-in user. Deciding here before
    // that settles bounced people straight back to the login page.
    if (authLoading) return;
    // Carry where they were headed, so signing in lands on this chat and not the
    // marketing page.
    if (!token) { router.push(loginWithNext()); return; }

    const headers = { Authorization: `Bearer ${token}` };
    const loadJSON = async (response: Response) => { const data = await response.json(); if (!response.ok) throw Error(zhError(data.error || '')); return data; };
    setChatError(null);
    Promise.all([
      fetch(`/api/characters/${charId}`, { headers }).then(loadJSON),
      (requestedConversation ? fetch('/api/conversations/'+encodeURIComponent(requestedConversation),{headers}) : fetch('/api/conversations', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: charId, newChat: wantsNewChat }) })).then(loadJSON),
    ]).then(([charData, convData]) => {
      if (charData.character) setCharacter(charData.character);
      if (convData.conversation) {
        setConversationId(convData.conversation.id);
        // A brand new room did not exist when the sidebar last loaded.
        notifyChatListChanged();
        return fetchLatestMessagePage(token, convData.conversation.id);
      }
    }).then(page => {
      if (page) applyLatestPage(page);
    }).catch(error => setChatError(error.message || '无法加载对话，请重试。'))
      .finally(() => setLoading(false));
  }, [charId, token, authLoading, requestedConversation]);

  // 漏斗顶：场景态就绪（开场已渲染、会话已打开）记一次到达；服务端按会话幂等去重。
  const trackedSceneOpenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeScene || !conversationId) return;
    if (trackedSceneOpenRef.current === conversationId) return;
    trackedSceneOpenRef.current = conversationId;
    trackSceneFunnelEvent(token, 'scene_opened', { conversationId, sceneId: activeScene.id });
  }, [activeScene, conversationId, token]);

  /** 首屏/重新对齐：用最新一页替换整段，并重置分页游标。 */
  function applyLatestPage(page: {messages: Message[]; hasMore: boolean; nextCursor: string | null}) {
    setMessages(page.messages);
    setLikedIds(new Set(page.messages.filter(m => m.likedAt).map(m => m.id)));
    setHasEarlier(page.hasMore);
    setEarlierCursor(page.nextCursor);
  }

  /** 往前翻一页并接到顶部；滚动位置要保住，否则用户会被弹回底部。 */
  async function loadEarlierMessages() {
    if (!conversationId || !earlierCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    const container = messageListRef.current;
    const before = container ? container.scrollHeight - container.scrollTop : 0;
    try {
      const page = await fetchEarlierMessagePage(token!, conversationId, earlierCursor);
      if (!page) return;
      skipAutoScrollRef.current = true;
      setMessages(prev => [...page.messages, ...prev]);
      setHasEarlier(page.hasMore);
      setEarlierCursor(page.nextCursor);
      // 让浏览器先完成布局，再按高度差把视口钉在原处。
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - before;
      });
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !conversationId || streaming) return;
    const content = input.trim();
    // 一次点击一个请求号（V3 §20）。同一条草稿再发一次就沿用同一个编号，
    // 否则服务端会当成另一笔请求，断线后也无从查询。
    const requestId = pendingSend.current?.content === content ? pendingSend.current.requestId : newRequestId();
    pendingSend.current = {requestId, content};
    // 场景漏斗第二级：只有本会话第一条用户消息才算“首条消息发出”。
    const firstSceneMessage = activeScene !== undefined && !messages.some(m => m.role === 'USER');
    setInput('');
    const userMsg: Message = { id: Date.now().toString(), role: 'USER', content, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamingText('');
    setChatError(null);
    setMockNotice(false);
    setInsufficientNotice('');

    const signal=startRequest();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content, requestId }),
      });
      if(!res.ok)setInput(content);
      const full = await consumeStream(res);
      pendingSend.current = null;
      if (full) {
        if (activeScene && firstSceneMessage) trackSceneFunnelEvent(token, 'scene_first_message_sent', { conversationId, sceneId: activeScene.id });
        // Re-read the thread so both messages carry their real database ids; the optimistic
        // ids above are timestamps, and liking a reply needs the id the server assigned.
        const fresh = await fetchLatestMessagePage(token!, conversationId, refetchPageSize(messages.length), signal);
        signal.throwIfAborted();
        if (fresh) {
          applyLatestPage(fresh);
        } else {
          setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ASSISTANT', content: full, createdAt: new Date().toISOString() }]);
        }
      }
    } catch (err) {
      if(signal.aborted)return;
      const failure = err as {code?: string; status?: number};
      if (failure.code === 'INSUFFICIENT_COINS' || failure.status === 402) {
        // 余额不足：草稿已在上面恢复，撤掉这条还没落库的乐观消息，并刷新额度给充值入口。
        setMessages(prev => prev.filter(item => item.id !== userMsg.id));
        pendingSend.current = null;
        setInsufficientNotice(err instanceof Error ? err.message : '金币余额不足。');
        void reloadQuota();
        return;
      }
      console.error(err);
      // 断线不换号重发：先按同一个请求号问服务端成了没有，成了就把回复补进列表。
      const settled = await queryTurn(token!, conversationId, requestId);
      if (settled?.messageId) {
        pendingSend.current = null;
        setChatError(null);
        await reloadMessages();
        void reloadQuota();
        return;
      }
      setChatError(err instanceof Error ? zhError(err.message) : '发送失败，请稍后重试。');
      // 失败会释放预扣（含免费次数的预占），余额与免费剩余可能已经变了。
      void reloadQuota();
      await reloadMessages(signal);
    } finally { if(!signal.aborted){setStreaming(false);setStreamingText('');} }
  }

  /**
   * 用户取消生成（V3 表 16）：断开连接后服务端按策略结算或释放，但不会再推 costResult。
   * 结算与保存回复在同一段收尾里，所以先等消息刷新回来，再重读额度，避免读到结算前的余额。
   */
  function cancelStreaming() {
    activeRequest.current?.abort();
    setStreaming(false);
    setStreamingText('');
    setBusyId(null);
    void reloadMessages().then(() => reloadQuota()).catch(() => {});
  }

  async function toggleMessageLike(messageId: string) {
    if (!conversationId) return;
    const liked = likedIds.has(messageId);
    // Optimistic, then reconciled: liking is idempotent server-side, so a double tap
    // cannot double count.
    setLikedIds(prev => {
      const next = new Set(prev);
      if (liked) next.delete(messageId); else next.add(messageId);
      return next;
    });
    const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}/like`, {
      method: liked ? 'DELETE' : 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setLikedIds(prev => {
        const next = new Set(prev);
        if (liked) next.add(messageId); else next.delete(messageId);
        return next;
      });
    }
  }

  async function reloadMessages(signal?:AbortSignal) {
    if (!conversationId) return;
    const fresh = await fetchLatestMessagePage(token!, conversationId, refetchPageSize(messages.length), signal);
    if (!signal?.aborted && fresh) applyLatestPage(fresh);
  }

  /** 发送与重生成共用同一条 SSE 线格式；读流实现在 ./turn-request 里。 */
  function consumeStream(res: Response) {
    return consumeChatStream(res, {onText: setStreamingText, onCost: applyCost, onMock: () => setMockNotice(true)});
  }

  async function regenerate(messageId: string) {
    if (!conversationId || streaming) return;
    stopSpeaking();
    setSpeakingId(null);
    setBusyId(messageId);
    // 重新生成也是「一次点击一个请求号」，同一个消息重试沿用同一个编号（V3 §20）。
    const requestId = pendingRegen.current?.messageId === messageId ? pendingRegen.current.requestId : newRequestId();
    pendingRegen.current = {messageId, requestId};
    // Keep the saved reply visible until a replacement is confirmed.
    // A failed request or history refresh must not hide previously saved content.
    setStreaming(true);
    setStreamingText('');
    setChatError(null);
    setMockNotice(false);
    const signal=startRequest();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}/regenerate`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId }),
      });
      await consumeStream(res);
      pendingRegen.current = null;
    } catch (err) {
      if(signal.aborted)return;
      console.error(err);
      // 断线先查后重试：查到新回复就收尾，查不到才把错误留给用户。
      const settled = await queryTurn(token!, conversationId, requestId);
      if (settled?.messageId) { pendingRegen.current = null; setChatError(null); }
      else setChatError(err instanceof Error ? zhError(err.message) : '重新生成失败。');
    } finally {
      if(!signal.aborted){
      setStreaming(false);
      setStreamingText('');
      setBusyId(null);
      await reloadMessages(signal);
      }
    }
  }

  async function saveEdit(messageId: string) {
    const content = editDraft.trim();
    if (!conversationId || !content) return;
    const signal=startRequest();
    // 保存后自动生成回复同样要带请求号（V3 §20）。
    const requestId = newRequestId();
    setBusyId(messageId);
    setChatError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PATCH',signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content }),
      });
      if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(zhError(data.error)||'修改消息失败。');}
      signal.throwIfAborted();
      setEditingId(null);
      await reloadMessages(signal);
      signal.throwIfAborted();
      // Generate against the edited message, without storing a duplicate user line.
      setStreaming(true);setStreamingText('');setMockNotice(false);
      const stream = await fetch(`/api/conversations/${conversationId}/messages/${messageId}/regenerate`, {
        method: 'POST',signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId }),
      });
      await consumeStream(stream);
    } catch (err) {
      if(signal.aborted)return;
      setChatError(err instanceof Error ? zhError(err.message) : '生成回复失败。');
    } finally {
      if(!signal.aborted){setBusyId(null);setStreaming(false);setStreamingText('');await reloadMessages(signal);}
    }
  }

  function toggleSpeak(messageId: string, content: string) {
    if (speakingId === messageId) { stopSpeaking(); setSpeakingId(null); return; }
    // spokenText drops the markup and the inner thoughts — a thought is what the prose is
    // withholding, so reading it aloud would give it away.
    const ok = speak(spokenText(content), () => setSpeakingId(null));
    setSpeakingId(ok ? messageId : null);
  }

  if (!charId && !requestedConversation) return <ChatInbox />;
  if (!charId && chatError) return <div className="p-6">{chatError}<Link href="/chat"> 返回聊天列表</Link></div>;
  if (authLoading || loading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 bg-zinc-950">
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Header */}
      <div className="bg-zinc-900/80 border-b border-white/10 backdrop-blur-xs px-4 py-3 flex items-center gap-3">
        <Link href="/discover" className="p-2 rounded-full hover:bg-white/5 transition-colors text-zinc-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        {character && (
          <>
            <CharacterAvatar character={character} size={40} />
            <div>
              <h2 className="font-semibold text-white">{character.name}</h2>
              <p className="text-xs text-zinc-400 truncate max-w-48">{character.personality.slice(0, 50)}</p>
            </div>
          </>
        )}
        {streaming && <div className="ml-auto flex items-center gap-2 text-xs text-purple-400"><div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />{"正在输入…"}</div>}
        {character && (
          <button
            onClick={() => setReporting(true)}
            aria-label={"举报角色"}
            title={"举报角色"}
            className={`${streaming ? '' : 'ml-auto '}rounded-full p-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-white`}
          >
            <Flag className="h-4 w-4" />
          </button>
        )}
      </div>

      {activeScene && showChapterClose ? (
        <div className="flex-1 overflow-y-auto px-4 py-6"><div className="mx-auto max-w-3xl"><ChapterClose sceneTitle={activeScene.title} data={buildChapterCloseData(messages)} publicOpenQuestions={activeScene.publicOpenQuestions} onContinue={() => { setShowChapterClose(false); if (conversationId) trackSceneFunnelEvent(token, 'scene_close_continue_clicked', { conversationId, sceneId: activeScene.id }); }} /></div></div>
      ) : (
      <>
      {/* Messages */}
      <div ref={messageListRef} className={`flex-1 overflow-y-auto px-4 py-6 w-full mx-auto ${readingMode ? 'max-w-2xl space-y-6 text-[15px] leading-loose' : 'max-w-3xl space-y-4'}`}>
        {hasEarlier && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={loadEarlierMessages}
              disabled={loadingEarlier}
              className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60"
            >
              {loadingEarlier ? '正在加载…' : '加载更早的消息'}
            </button>
          </div>
        )}
        {messages.length === 0 && character && (
          <div className="text-center py-8">
            <CharacterAvatar character={character} size={64} className="mx-auto mb-3" />
            <p className="text-zinc-300 text-lg font-semibold mb-1">{character.name}</p>
            <p className="text-zinc-400 text-sm">
              {activeScene ? <RoleplayText text={activeScene.opening ?? activeScene.hook} /> : character.greeting
                ? <RoleplayText text={character.greeting} />
                : "你好！我是" + (character.name) + "，很高兴认识你。"}
            </p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}>
            {msg.role !== 'USER' && character && (
              <CharacterAvatar character={character} size={32} className="mr-2 mt-1" />
            )}
            <div className={`group/msg flex min-w-0 max-w-full flex-col gap-1 md:flex-row md:items-end ${msg.role === 'USER' ? 'items-end' : 'items-start'}`}>
              {editingId === msg.id ? (
                <div className="w-full max-w-md rounded-2xl bg-zinc-800 p-3">
                  <textarea
                    value={editDraft}
                    onChange={e => setEditDraft(e.target.value)}
                    rows={3}
                    autoFocus
                    className="w-full resize-none rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-purple-500/50 focus:outline-hidden"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {"编辑后将重新生成回复"}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex-1 rounded-full border border-white/10 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
                    >
                      {"取消"}</button>
                    <button
                      onClick={() => saveEdit(msg.id)}
                      disabled={!editDraft.trim() || busyId === msg.id}
                      className="flex-1 rounded-full bg-purple-600 py-1.5 text-xs font-bold text-white hover:bg-purple-500 disabled:opacity-40"
                    >
                      {busyId === msg.id ? "正在保存…" : "保存并重新生成"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={`max-w-xs break-words md:max-w-md lg:max-w-lg rounded-2xl px-4 py-3 ${
                    msg.role === 'USER'
                      ? 'bg-linear-to-br/srgb from-purple-600 to-pink-600 text-white rounded-br-sm'
                      : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
                  }`}>
                    {msg.role === 'USER' ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                    ) : containsBannedWord(msg.content, bannedWords) ? (
                      <HiddenReply>
                        <RoleplayText text={msg.content} />
                      </HiddenReply>
                    ) : (
                      <RoleplayText text={msg.content} />
                    )}
                  </div>
                  <MessageActions
                    role={msg.role}
                    content={msg.content}
                    liked={likedIds.has(msg.id)}
                    speaking={speakingId === msg.id}
                    busy={busyId === msg.id}
                    disabled={streaming}
                    onLike={() => toggleMessageLike(msg.id)}
                    onRegenerate={() => regenerate(msg.id)}
                    onEdit={() => { setEditingId(msg.id); setEditDraft(msg.content); }}
                    onSpeak={() => toggleSpeak(msg.id, msg.content)}
                    onReport={msg.role==='ASSISTANT'?()=>setReportingMessage(msg.id):undefined}
                  />
                </>
              )}
            </div>
          </div>
        ))}
        {streaming && streamingText && (
          <div className="flex justify-start">
            {character && <CharacterAvatar character={character} size={32} className="mr-2 mt-1" />}
            <div className="max-w-xs md:max-w-md lg:max-w-lg bg-zinc-800 rounded-2xl rounded-bl-sm px-4 py-3">
              <RoleplayText text={streamingText} streaming />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-white/10 px-4 py-2">
        {conversationId&&token&&<ConversationTools conversationId={conversationId} token={token} title={character?.name} disabled={streaming} onDeleted={()=>router.push('/chat')}/>}
        {activeScene && <button type="button" onClick={() => setEndChapterDialogOpen(true)} className="text-sm text-zinc-400 hover:text-white">结束本次体验</button>}
      </div>

      {/* Input */}
      <div className="bg-zinc-900/80 border-t border-white/10 backdrop-blur-xs px-4 py-4">
        <QuotaBar quota={quota} loading={quotaLoading} error={quotaError} insufficient={Boolean(insufficientNotice)} onRetry={() => void reloadQuota()} />
        {insufficientNotice && (
          <div role="alert" className="mx-auto mb-3 flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <span className="min-w-0 flex-1">{insufficientNotice}</span>
            <span className="text-xs text-amber-300/80">草稿已保留</span>
            <Link href="/shop" className="rounded-full border border-amber-400/40 px-2.5 py-1 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-400/20">
              去充值
            </Link>
          </div>
        )}
        {streaming && (
          <StreamCancelRow
            cancelPolicy={quota?.cancelPolicy}
            freeCancelRemaining={quota?.freeCancelRemaining}
            outputStarted={streamingText.length > 0}
            onCancel={cancelStreaming}
          />
        )}
        {chatError && (
          <div role="alert" className="mx-auto mb-3 max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {chatError}
          </div>
        )}
        {mockNotice && (
          <div role="status" className="mx-auto mb-3 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            本轮为测试模拟回复，并非真实 AI 模型生成。
          </div>
        )}
        {shortcuts.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
            {shortcuts.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setInput(prev => (prev ? `${prev} ${s.text}` : s.text))}
                className="rounded-full border border-white/10 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-white/25 hover:text-white"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {activeScene && <div className="mx-auto mb-2 max-w-3xl"><ActionSuggestions suggestions={activeScene.suggestions} onPick={text => setInput(prev => prev ? prev + ' ' + text : text)} disabled={streaming} /></div>}
        <form onSubmit={sendMessage} className="max-w-3xl mx-auto flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={streaming}
            maxLength={chatMaxChars}
            placeholder={"发送消息给" + (character?.name || '角色') + "..."}
            className="flex-1 px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-hidden focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all disabled:opacity-50"
          />
          {/* 图标按钮没有文字，必须给可访问名，否则读屏与自动化都点不到。 */}
          <button type="submit" aria-label={"发送"} disabled={streaming || !input.trim()}
            className="p-3 bg-linear-to-br/srgb from-purple-600 to-pink-600 rounded-xl text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20">
            {streaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      </div>
      </>
      )}
    </div>

      {activeScene && <EndChapterDialog open={endChapterDialogOpen} onClose={() => setEndChapterDialogOpen(false)} onConfirm={() => { setEndChapterDialogOpen(false); setShowChapterClose(true); if (conversationId) trackSceneFunnelEvent(token, 'scene_active_end_confirmed', { conversationId, sceneId: activeScene.id }); }} />}

      {conversationId && token && (
        <RelationshipPanel
          conversationId={conversationId}
          token={token}
          onArchived={() => router.push('/discover')}
        />
      )}

      {conversationId && token && <MemoryPanel conversationId={conversationId} token={token} />}

      {reportingMessage&&<ReportDialog targetType="MESSAGE" targetId={reportingMessage} targetName="这条 AI 回复" onClose={()=>setReportingMessage(null)}/>}
      {reporting && character && (
        <ReportDialog
          targetType="CHARACTER"
          targetId={character.id}
          targetName={character.name}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-8 h-8 text-purple-400 animate-spin" /></div>}>
      <ChatRouteContent />
    </Suspense>
  );
}