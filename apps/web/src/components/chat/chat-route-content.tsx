'use client';
import { ChatConversationList } from './chat-conversation-list';
import { StoryMode } from '@/components/chat/story-mode';
import { ConversationTools } from '@/components/chat/conversation-tools';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@web/lib/auth-context';
import { readNumber, useUiConfig } from '@web/lib/settings/use-ui-config';
import { loginWithNext } from '@web/lib/next-path';
import { RelationshipPanel } from '@/components/chat/relationship-panel';
import { MemoryPanel } from '@/components/chat/memory-panel';
import { ReportDialog } from '@/components/moderation';
import { parseShortcuts, parseBannedWords, type Shortcut } from '@web/lib/preferences';
import { useChatScroll, useCompositionGuard } from '@/components/chat/chat-interaction';
import { useQuota } from '@web/lib/hooks/use-quota';
import { ChapterClose } from '@/components/stories/chapter-close';
import { EndChapterDialog } from '@/components/stories/end-chapter-dialog';
import { getSceneConfigByCharacterId } from '@rumiai/contracts/stories/scene-config';
import { resolveScene } from '@rumiai/contracts/stories/scene-service';
import { buildChapterCloseData } from '@rumiai/contracts/stories/chapter-close';
import { trackSceneFunnelEvent } from '@/lib/analytics-client/scene-funnel-client';
import { Loader2 } from 'lucide-react';
import { ChatPanelSheet } from './chat-panel-sheet';
import { DesignIcon } from '@/components/primitives/design-icon';
import Link from 'next/link';
import { ChatHeader } from './chat-header';
import { BackButton } from '@/components/layout/back-button';
import { ChatMessageList } from './chat-message-list';
import { ChatComposer } from './chat-composer';
import { ChatShareAndDispute } from './chat-share-dispute';
import { useChatThread } from './use-chat-thread';
import { useChatTurns } from './use-chat-turns';

function ChatRouteResolver() {
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
  const [endChapterDialogOpen, setEndChapterDialogOpen] = useState(false);
  const [showChapterClose, setShowChapterClose] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [conversationPanel, setConversationPanel] = useState<'relationship' | 'memory' | null>(null);
  const [reportingMessage,setReportingMessage]=useState<string|null>(null);
  // Reader preferences. readingMode enlarges the prose, bannedWords hides a reply behind a
  // tap rather than deleting it, and shortcuts fill the composer.
  const readingMode = Boolean(user?.readingMode);
  const bannedWords = parseBannedWords(user?.bannedWords);
  const shortcuts: Shortcut[] = parseShortcuts(user?.shortcuts);
  const requestedConversation = searchParams.get('conversation');
  const [resolvedCharId,setResolvedCharId] = useState<string|null>(null);
  const charId = searchParams.get('character') || resolvedCharId;
  const requestedScene = searchParams.get('scene') === '1';
  // "新建聊天" on the detail dialog asks for a fresh room instead of reopening the last one.
  const wantsNewChat = searchParams.get('new') === '1';
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  // 流式输出只在贴底时跟随；用户上翻回看时不被打断（V3 §19）。
  const chatScroll = useChatScroll(messagesEndRef);
  const composer = useCompositionGuard(chatScroll.revealComposer);

  const requireLogin = () => router.push(loginWithNext());
  const thread = useChatThread({charId, token, authLoading, requestedConversation, wantsNewChat, router, chatScroll, messageListRef, requireLogin});
  const {character, messages, conversationId, loading, chatError, setChatError, setLoading} = thread;

  const sceneConfig = requestedScene && charId ? getSceneConfigByCharacterId(charId) : undefined;
  const sceneResolution = requestedScene && character ? resolveScene(character, sceneConfig) : undefined;
  const activeScene = sceneResolution?.kind === 'available' ? sceneResolution.scene : undefined;

  // 额度行与取消计费提示（V3 表 15/16）：数值只来自 /api/me/quota 与 SSE 的 cost 事件。
  const {quota, loading: quotaLoading, error: quotaError, reload: reloadQuota, applyCost} = useQuota(token);

  const turns = useChatTurns({
    token, conversationId, messages, setMessages: thread.setMessages, applyLatestPage: thread.applyLatestPage,
    reloadMessages: thread.reloadMessages, reloadQuota, applyCost, setChatError, activeScene,
    isComposing: composer.isComposing,
  });
  const {streaming, streamingText, input, setInput, editingId, setEditingId, editDraft, setEditDraft, busyId, speakingId} = turns;

  useEffect(()=>{turns.resetTurns();return()=>{turns.abortRequest();};},[charId,requestedConversation,conversationId]);
  useEffect(()=>{setResolvedCharId(null);if(!requestedConversation)return;if(!token){if(!authLoading)router.push(loginWithNext());return;}fetch('/api/conversations/'+encodeURIComponent(requestedConversation),{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(data=>setResolvedCharId(data.conversation.character.id)).catch(()=>{setChatError('无法打开该对话，请返回聊天列表。');setLoading(false)});},[requestedConversation,token,authLoading,router,setChatError,setLoading]);

  useEffect(() => { chatScroll.followTail(); }, [messages, streamingText, chatScroll.followTail]);

  // 漏斗顶：场景态就绪（开场已渲染、会话已打开）记一次到达；服务端按会话幂等去重。
  const trackedSceneOpenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeScene || !conversationId) return;
    if (trackedSceneOpenRef.current === conversationId) return;
    trackedSceneOpenRef.current = conversationId;
    trackSceneFunnelEvent(token, 'scene_opened', { conversationId, sceneId: activeScene.id });
  }, [activeScene, conversationId, token]);

  if (!charId && !requestedConversation) return <ChatConversationList variant="inbox" />;
  if (chatError && !conversationId) return <div className="p-6"><BackButton fallback="/chat" /><p role="alert" className="mt-4">{chatError}</p><Link href="/chat" className="mt-3 inline-flex min-h-11 items-center text-brand">返回聊天列表</Link></div>;
  if (!authLoading && !token) return <div className="p-6"><BackButton fallback="/chat" /><p className="mt-4 text-sm text-muted-foreground">登录后继续这段对话。</p><Link href={loginWithNext()} className="mt-3 inline-flex min-h-11 items-center text-brand">前往登录</Link></div>;
  if (authLoading || loading) return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="px-3 py-2"><BackButton fallback="/chat" /></div>
      <div role="status" aria-label="正在加载对话" className="flex flex-1 items-center justify-center"><Loader2 className="w-8 h-8 text-brand animate-spin" /></div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
    <div className="flex min-w-0 flex-1 flex-col">
      <ChatHeader character={character} streaming={streaming} onReport={() => setReporting(true)} />
      {conversationId && token && <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2"><button type="button" onClick={() => setConversationPanel('relationship')} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs text-foreground"><DesignIcon name="ph:heart-straight" size={16} className="text-brand" />关系</button><button type="button" onClick={() => setConversationPanel('memory')} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs text-foreground"><DesignIcon name="ph:brain" size={16} className="text-brand" />记忆</button>{activeScene && <span className="ml-auto text-xs text-muted-foreground">{activeScene.title}</span>}</div>}

      {activeScene && showChapterClose ? (
        <div className="flex-1 overflow-y-auto px-4 py-6"><div className="mx-auto max-w-3xl"><ChapterClose sceneTitle={activeScene.title} data={buildChapterCloseData(messages)} publicOpenQuestions={activeScene.publicOpenQuestions} onContinue={() => { setShowChapterClose(false); if (conversationId) trackSceneFunnelEvent(token, 'scene_close_continue_clicked', { conversationId, sceneId: activeScene.id }); }} /></div></div>
      ) : (
      <>
      <ChatMessageList
        messages={messages}
        character={character}
        activeScene={activeScene}
        readingMode={readingMode}
        bannedWords={bannedWords}
        likedIds={thread.likedIds}
        speakingId={speakingId}
        busyId={busyId}
        editingId={editingId}
        editDraft={editDraft}
        streaming={streaming}
        streamingText={streamingText}
        hasEarlier={thread.hasEarlier}
        loadingEarlier={thread.loadingEarlier}
        chatScroll={chatScroll}
        messageListRef={messageListRef}
        messagesEndRef={messagesEndRef}
        onLoadEarlier={() => void thread.loadEarlierMessages()}
        onToggleLike={(id) => void thread.toggleMessageLike(id)}
        onSpeak={turns.toggleSpeak}
        onRegenerate={(id) => void turns.regenerate(id)}
        onSaveEdit={(id) => void turns.saveEdit(id)}
        onReportMessage={setReportingMessage}
        setEditingId={setEditingId}
        setEditDraft={setEditDraft}
      />

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-1">
        {conversationId&&token&&<ChatShareAndDispute conversationId={conversationId} disabled={streaming}/>}
        {conversationId&&token&&<ConversationTools conversationId={conversationId} token={token} title={character?.name} disabled={streaming} onDeleted={()=>router.push('/chat')}/>}
        {activeScene && <button type="button" onClick={() => setEndChapterDialogOpen(true)} className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">结束本次体验</button>}
      </div>

      <ChatComposer
        quota={quota}
        quotaLoading={quotaLoading}
        quotaError={quotaError}
        onRetryQuota={() => void reloadQuota()}
        insufficientNotice={turns.insufficientNotice}
        streaming={streaming}
        streamingText={streamingText}
        cancelPolicy={quota?.cancelPolicy}
        freeCancelRemaining={quota?.freeCancelRemaining}
        onCancel={turns.cancelStreaming}
        chatError={chatError}
        mockNotice={turns.mockNotice}
        mediaNotice={turns.mediaNotice}
        mediaBusy={turns.mediaBusy}
        shortcuts={shortcuts}
        activeScene={activeScene}
        composer={composer}
        input={input}
        setInput={setInput}
        streamingBusy={streaming}
        characterName={character?.name}
        chatMaxChars={chatMaxChars}
        onSubmit={turns.sendMessage}
        onSendImage={turns.sendImage}
        onSendSticker={turns.sendSticker}
      />
      </>
      )}
    </div>

      {activeScene && <EndChapterDialog open={endChapterDialogOpen} onClose={() => setEndChapterDialogOpen(false)} onConfirm={() => { setEndChapterDialogOpen(false); setShowChapterClose(true); if (conversationId) trackSceneFunnelEvent(token, 'scene_active_end_confirmed', { conversationId, sceneId: activeScene.id }); }} />}

      {conversationId && token && <ChatPanelSheet open={conversationPanel !== null} onClose={() => setConversationPanel(null)} title={conversationPanel === 'memory' ? '角色记忆' : '对话关系'}>
        <div hidden={conversationPanel !== 'relationship'} className="[&>aside]:!block [&>aside]:!w-full [&>aside]:!min-w-0 [&>aside]:!border-0"><RelationshipPanel conversationId={conversationId} token={token} onArchived={() => router.push('/chat')} /></div>
        <div hidden={conversationPanel !== 'memory'}><MemoryPanel conversationId={conversationId} token={token} defaultOpen /></div>
      </ChatPanelSheet>}

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

export function ChatRouteContent() {
  return (
    <Suspense fallback={<div className="flex h-full min-h-0 items-center justify-center bg-background"><Loader2 className="w-8 h-8 text-brand animate-spin" /></div>}>
      <ChatRouteResolver />
    </Suspense>
  );
}
