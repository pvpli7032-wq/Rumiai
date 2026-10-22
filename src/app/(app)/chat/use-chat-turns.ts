'use client';

import { useRef, useState } from 'react';
import { zhError } from '@/lib/copy/zh';
import { spokenText } from '@/lib/rp-markup';
import { speak, stopSpeaking } from '@/lib/speech';
import { trackSceneFunnelEvent } from '@/lib/analytics/scene-funnel-client';
import { fetchLatestMessagePage, refetchPageSize } from '@/lib/conversations/message-history-client';
import type { ChatMessage as Message } from '@/lib/api-types/conversations';
import { consumeChatStream, newRequestId, queryTurn, type StreamHandlers } from './turn-request';
import type { MessagePage } from './use-chat-thread';

/**
 * 一次对话回合的生命周期：发送、取消、重新生成、编辑后重生成、朗读。
 * 请求号规则（V3 §20）只在这里实现一份：同一条草稿/同一条消息重试沿用同一个编号。
 */
export function useChatTurns(opts: {
  token: string | null;
  conversationId: string | null;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  applyLatestPage: (page: MessagePage) => void;
  reloadMessages: (signal?: AbortSignal) => Promise<void>;
  reloadQuota: () => Promise<unknown> | void;
  applyCost: StreamHandlers['onCost'];
  setChatError: (value: string | null) => void;
  activeScene?: { id: string };
  isComposing: () => boolean;
}) {
  const { token, conversationId, messages, setMessages, applyLatestPage, reloadMessages, reloadQuota, applyCost, setChatError, activeScene, isComposing } = opts;
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [mockNotice, setMockNotice] = useState(false);
  const [insufficientNotice, setInsufficientNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  // 一次点击一个请求号（V3 §20）：同一条草稿重试沿用同一个编号，成功后清空。
  const pendingSend = useRef<{requestId: string; content: string} | null>(null);
  // 重新生成同理：同一个消息被连点重试时沿用同一个编号。
  const pendingRegen = useRef<{messageId: string; requestId: string} | null>(null);

  function startRequest() {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    return controller.signal;
  }

  const chatHandlers = {onText: setStreamingText, onCost: applyCost, onMock: () => setMockNotice(true)};

  /** 换会话/卸载时收尾：断掉在途请求，清掉流式状态。 */
  function resetTurns() {
    setStreaming(false);
    setStreamingText('');
    setBusyId(null);
  }
  function abortRequest() {
    activeRequest.current?.abort();
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    // 组合输入未结束：回车是在确认候选词，不是发送（V3 §19）。
    if (isComposing()) return;
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

    const signal = startRequest();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content, requestId }),
      });
      if (!res.ok) setInput(content);
      const full = await consumeChatStream(res, chatHandlers);
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
      if (signal.aborted) return;
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
    } finally { if (!signal.aborted) { setStreaming(false); setStreamingText(''); } }
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
    const signal = startRequest();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}/regenerate`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId }),
      });
      await consumeChatStream(res, chatHandlers);
      pendingRegen.current = null;
    } catch (err) {
      if (signal.aborted) return;
      console.error(err);
      // 断线先查后重试：查到新回复就收尾，查不到才把错误留给用户。
      const settled = await queryTurn(token!, conversationId, requestId);
      if (settled?.messageId) { pendingRegen.current = null; setChatError(null); }
      else setChatError(err instanceof Error ? zhError(err.message) : '重新生成失败。');
    } finally {
      if (!signal.aborted) {
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
    const signal = startRequest();
    // 保存后自动生成回复同样要带请求号（V3 §20）。
    const requestId = newRequestId();
    setBusyId(messageId);
    setChatError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PATCH', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(zhError(data.error) || '修改消息失败。'); }
      signal.throwIfAborted();
      setEditingId(null);
      await reloadMessages(signal);
      signal.throwIfAborted();
      // Generate against the edited message, without storing a duplicate user line.
      setStreaming(true); setStreamingText(''); setMockNotice(false);
      const stream = await fetch(`/api/conversations/${conversationId}/messages/${messageId}/regenerate`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId }),
      });
      await consumeChatStream(stream, chatHandlers);
    } catch (err) {
      if (signal.aborted) return;
      setChatError(err instanceof Error ? zhError(err.message) : '生成回复失败。');
    } finally {
      if (!signal.aborted) { setBusyId(null); setStreaming(false); setStreamingText(''); await reloadMessages(signal); }
    }
  }

  function toggleSpeak(messageId: string, content: string) {
    if (speakingId === messageId) { stopSpeaking(); setSpeakingId(null); return; }
    // spokenText drops the markup and the inner thoughts — a thought is what the prose is
    // withholding, so reading it aloud would give it away.
    const ok = speak(spokenText(content), () => setSpeakingId(null));
    setSpeakingId(ok ? messageId : null);
  }

  return {
    input, setInput, streaming, streamingText, mockNotice, insufficientNotice, editingId, setEditingId,
    editDraft, setEditDraft, speakingId, busyId, sendMessage, cancelStreaming, regenerate, saveEdit,
    toggleSpeak, resetTurns, abortRequest,
  };
}
