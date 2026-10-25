'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyChatListChanged } from '@rumiai/contracts/conversations/chat-events';
import { zhError } from '@rumiai/contracts/copy/zh';
import { spokenText } from '@web/lib/rp-markup';
import { speak, stopSpeaking } from '@web/lib/speech';
import { trackSceneFunnelEvent } from '@/lib/analytics-client/scene-funnel-client';
import { fetchLatestMessagePage, refetchPageSize } from '@web/lib/conversations/message-history-client';
import type { ChatMessage as Message } from '@rumiai/contracts/api-types/conversations';
import { consumeChatStream, newRequestId, queryTurn, type StreamHandlers } from './turn-request';
import type { MessagePage } from './use-chat-thread';

/**
 * 一次对话回合的生命周期：发送、取消、重新生成、编辑后重生成、朗读。
 * 请求号规则（V3 §20）只在这里实现一份：同一条草稿/同一条消息重试沿用同一个编号。
 */
export function useChatTurns(opts: {
  token: string | null;
  userId: string | null;
  characterId?: string | null;
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
  streamDisplayMode?: 'stream' | 'complete';
  speechRate?: 0.75 | 1 | 1.25 | 1.5;
}) {
  const { token, userId, characterId, conversationId, messages, setMessages, applyLatestPage, reloadMessages, reloadQuota, applyCost, setChatError, activeScene, isComposing } = opts;
  const draftKey = userId && conversationId ? 'xingban:chat-draft:' + userId + ':' + conversationId : null;
  const [draftState, setDraftState] = useState<{key: string | null; input: string}>({key: null, input: ''});
  const input = draftState.key === draftKey ? draftState.input : '';
  const draftValue = useRef('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [mockNotice, setMockNotice] = useState(false);
  const [insufficientNotice, setInsufficientNotice] = useState('');
  const [mediaNotice, setMediaNotice] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const mediaBusyRef = useRef(false);
  const pendingMedia = useRef<{signature: string; requestId: string} | null>(null);
  // 一次点击一个请求号（V3 §20）：同一条草稿重试沿用同一个编号，成功后清空。
  const pendingSend = useRef<{requestId: string; content: string} | null>(null);
  // 重新生成同理：同一个消息被连点重试时沿用同一个编号。
  const pendingRegen = useRef<{messageId: string; requestId: string; signature: string} | null>(null);


  function storeDraft(value: string, pending = pendingSend.current) {
    if (!draftKey) return;
    try {
      if (!value && !pending) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({input: value, pending}));
    } catch { /* In-memory editing still works if storage is blocked. */ }
  }
  const setInput: React.Dispatch<React.SetStateAction<string>> = useCallback(value => {
    const next = typeof value === 'function' ? value(draftValue.current) : value;
    draftValue.current = next;
    setDraftState({key: draftKey, input: next});
    if (draftKey) {
      try {
        if (!next && !pendingSend.current) localStorage.removeItem(draftKey);
        else localStorage.setItem(draftKey, JSON.stringify({input: next, pending: pendingSend.current}));
      } catch { /* Keep editing in memory. */ }
    }
  }, [draftKey]);
  function rememberPending(value: {requestId: string; content: string} | null) {
    pendingSend.current = value;
    storeDraft(draftValue.current, value);
  }
  useEffect(() => {
    pendingSend.current = null; pendingRegen.current = null; pendingMedia.current = null;
    let restored = '';
    if (draftKey) {
      try {
        const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
        if (saved && typeof saved.input === 'string') restored = saved.input;
        if (saved?.pending && typeof saved.pending.content === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(saved.pending.requestId)) {
          pendingSend.current = saved.pending;
          restored ||= saved.pending.content;
        }
      } catch { /* A stale cache must not block opening the conversation. */ }
    }
    if (!restored && userId && characterId) {
      try { const key = 'xingban:onboarding-draft:' + userId + ':' + characterId; const first = sessionStorage.getItem(key); if (first) {restored = first; sessionStorage.removeItem(key); if (draftKey) localStorage.setItem(draftKey, JSON.stringify({input: first, pending: null}));} } catch { /* Keep the existing draft when browser storage is unavailable. */ }
    }
    draftValue.current = restored;
    setDraftState({key: draftKey, input: restored});
    if (!token || !conversationId || !pendingSend.current) return;
    const pending = pendingSend.current;
    let cancelled = false;
    void queryTurn(token, conversationId, pending.requestId).then(async result => {
      if (cancelled || !result) return;
      if (result.status === 'DONE') {
        rememberPending(null);
        if (draftValue.current === pending.content) setInput('');
        await reloadMessages(); notifyChatListChanged();
        void reloadQuota();
      } else if (result.status === 'FAILED') {
        rememberPending(null);
      } else {
        setChatError(result.status === 'PENDING' ? '上一条消息仍在处理中，请稍后刷新结果。' : '已恢复未确认的消息，再次发送将使用同一请求号。');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [draftKey, token, userId, characterId]);

  function startRequest() {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    return controller.signal;
  }

  const chatHandlers = {onText: opts.streamDisplayMode === 'complete' ? () => {} : setStreamingText, onCost: applyCost, onMock: () => setMockNotice(true)};

  /** 换会话/卸载时收尾：断掉在途请求，清掉流式状态。 */
  function resetTurns() {
    setStreaming(false);
    setStreamingText('');
    setBusyId(null);
  }
  function abortRequest() {
    activeRequest.current?.abort();
    stopSpeaking();
  }

  async function saveAttachment(attachment: Record<string, unknown>, content = ''): Promise<boolean> {
    if (!conversationId || !token || mediaBusyRef.current || streaming) return false;
    const signature = JSON.stringify({attachment, content});
    const requestId = pendingMedia.current?.signature === signature ? pendingMedia.current.requestId : newRequestId();
    pendingMedia.current = {signature, requestId};
    mediaBusyRef.current = true; setMediaBusy(true); setChatError(null); setMediaNotice('');
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages/attachments`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({content, attachment, requestId})});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '附件保存失败，请重试。');
      setMediaNotice(data.aiNotice || '附件已保存。');
      pendingMedia.current = null; await reloadMessages(); notifyChatListChanged();
      return true;
    } catch (error) { setChatError(error instanceof Error ? zhError(error.message) : '附件保存失败，请重试。'); return false; }
    finally { mediaBusyRef.current = false; setMediaBusy(false); }
  }

  async function sendImage(file: File, content: string): Promise<boolean> {
    if (!conversationId || !token || mediaBusyRef.current || streaming) return false;
    const signature = `IMAGE:${file.name}:${file.size}:${file.lastModified}:${content}`;
    const requestId = pendingMedia.current?.signature === signature ? pendingMedia.current.requestId : newRequestId();
    pendingMedia.current = {signature, requestId};
    mediaBusyRef.current = true; setMediaBusy(true); setChatError(null); setMediaNotice('');
    try {
      const form = new FormData(); form.set('file', file);
      const upload = await fetch('/api/upload', {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: form});
      const asset = await upload.json();
      if (!upload.ok) throw Error(asset.error || '图片上传失败，请重试。');
      const response = await fetch(`/api/conversations/${conversationId}/messages/attachments`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({content, requestId, attachment: {type: 'IMAGE', assetId: asset.id, mimeType: asset.mimeType, byteSize: asset.size}})});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '图片保存失败，请重试。');
      pendingMedia.current = null; setMediaNotice(data.aiNotice || '图片已保存。'); await reloadMessages(); notifyChatListChanged(); return true;
    } catch (error) { setChatError(error instanceof Error ? zhError(error.message) : '图片上传失败，请重试。'); return false; }
    finally { mediaBusyRef.current = false; setMediaBusy(false); }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    // 组合输入未结束：回车是在确认候选词，不是发送（V3 §19）。
    if (isComposing()) return;
    if (!input.trim() || !conversationId || !token || streaming) return;
    if (pendingSend.current) {
      const pending = pendingSend.current;
      const state = await queryTurn(token, conversationId, pending.requestId);
      if (!state || state.status === 'PENDING') { setChatError('上一条消息的结果尚未确认，请稍后再次检查。'); return; }
      if (state.status === 'DONE') {
        rememberPending(null); await reloadMessages(); notifyChatListChanged(); void reloadQuota();
        if (pending.content === input.trim()) { setInput(''); setChatError(null); return; }
      } else if (state.status === 'FAILED' || pending.content !== input.trim()) rememberPending(null);
    }
    const content = input.trim();
    // 一次点击一个请求号（V3 §20）。同一条草稿再发一次就沿用同一个编号，
    // 否则服务端会当成另一笔请求，断线后也无从查询。
    const requestId = pendingSend.current?.content === content ? pendingSend.current.requestId : newRequestId();
    rememberPending({requestId, content});
    // 场景漏斗第二级：只有本会话第一条用户消息才算“首条消息发出”。
    const firstSceneMessage = activeScene !== undefined && !messages.some(m => m.role === 'USER');
    setInput('');
    const userMsg: Message & {clientState: 'SENDING' | 'PENDING'} = { id: Date.now().toString(), role: 'USER', content, createdAt: new Date().toISOString(), clientState: 'SENDING' };
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
      else setMessages(previous => previous.map(message => message.id === userMsg.id ? {...message, clientState: 'PENDING'} : message));
      const full = await consumeChatStream(res, chatHandlers);
      signal.throwIfAborted();
      rememberPending(null);
      if (full) {
        if (activeScene && firstSceneMessage) trackSceneFunnelEvent(token, 'scene_first_message_sent', { conversationId, sceneId: activeScene.id });
        // Re-read the thread so both messages carry their real database ids; the optimistic
        // ids above are timestamps, and liking a reply needs the id the server assigned.
        const fresh = await fetchLatestMessagePage(token!, conversationId, refetchPageSize(messages.length), signal);
        signal.throwIfAborted();
        if (fresh) {
          applyLatestPage(fresh);
          notifyChatListChanged();
        } else {
          setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ASSISTANT', content: full, createdAt: new Date().toISOString() }]);
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      setInput(content);
      const failure = err as {code?: string; status?: number};
      if (failure.code === 'INSUFFICIENT_COINS' || failure.status === 402) {
        // 余额不足：草稿已在上面恢复，撤掉这条还没落库的乐观消息，并刷新额度给充值入口。
        setMessages(prev => prev.filter(item => item.id !== userMsg.id));
        rememberPending(null);
        setInsufficientNotice(err instanceof Error ? err.message : '金币余额不足。');
        void reloadQuota();
        return;
      }
      console.error(err);
      // 断线不换号重发：先按同一个请求号问服务端成了没有，成了就把回复补进列表。
      const settled = await queryTurn(token!, conversationId, requestId);
      if (settled?.messageId) {
        rememberPending(null);
        if (draftValue.current === content) setInput('');
        setChatError(null);
        await reloadMessages(); notifyChatListChanged();
        void reloadQuota();
        return;
      }
      setChatError(err instanceof Error ? zhError(err.message) : '发送失败，请稍后重试。');
      // 失败会释放预扣（含免费次数的预占），余额与免费剩余可能已经变了。
      void reloadQuota();
      await reloadMessages(signal); notifyChatListChanged();
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
    if (pendingSend.current) setInput(pendingSend.current.content);
    void reloadMessages().then(() => reloadQuota()).catch(() => {});
  }

  async function regenerate(messageId: string, revision?: {kind: 'CONTINUE' | 'SUGGEST'; instruction?: string}) {
    if (!conversationId || streaming) return;
    stopSpeaking();
    setSpeakingId(null);
    setBusyId(messageId);
    // 重新生成也是「一次点击一个请求号」，同一个消息重试沿用同一个编号（V3 §20）。
    const signature = JSON.stringify({messageId, revision});
    const requestId = pendingRegen.current?.signature === signature ? pendingRegen.current.requestId : newRequestId();
    pendingRegen.current = {messageId, requestId, signature};
    // Keep the saved reply visible until a replacement is confirmed.
    // A failed request or history refresh must not hide previously saved content.
    setStreaming(true);
    setStreamingText('');
    setChatError(null);
    setMockNotice(false);
    const signal = startRequest();
    try {
      const action = revision ? revision.kind === 'CONTINUE' ? 'continue' : 'suggest' : 'regenerate';
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}/${action}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({requestId, instruction: revision?.instruction}),
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
        await reloadMessages(signal); notifyChatListChanged();
      }
    }
  }

  async function saveEdit(messageId: string) {
    const content = editDraft.trim();
    if (!conversationId || !content || streaming) return;
    if (!window.confirm('编辑这条消息会删除其后的消息并重新生成回复，费用按当前模型计算。确认继续？')) return;
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
      await reloadMessages(signal); notifyChatListChanged();
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
      if (!signal.aborted) { setBusyId(null); setStreaming(false); setStreamingText(''); await reloadMessages(signal); notifyChatListChanged(); }
    }
  }


  async function deleteFollowing(messageId: string) {
    if (!conversationId || !token || streaming || busyId) return;
    if (!window.confirm('将永久删除这条及之后的消息，相关记忆和故事状态也会失效。确认删除？')) return;
    setBusyId(messageId); setChatError(null);
    try {
      const response = await fetch('/api/conversations/' + conversationId + '/messages/' + messageId, {method: 'DELETE', headers: {Authorization: 'Bearer ' + token}});
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw Error(body.error || '删除失败，请重试。'); }
      setEditingId(null); await reloadMessages(); notifyChatListChanged(); void reloadQuota();
    } catch (error) { setChatError(error instanceof Error ? zhError(error.message) : '删除失败，请重试。'); }
    finally { setBusyId(null); }
  }

  function toggleSpeak(messageId: string, content: string) {
    if (speakingId === messageId) { stopSpeaking(); setSpeakingId(null); return; }
    // spokenText drops the markup and the inner thoughts — a thought is what the prose is
    // withholding, so reading it aloud would give it away.
    const ok = speak(spokenText(content), () => setSpeakingId(null), opts.speechRate, () => setChatError('设备朗读失败，请检查语音服务或稍后重试。'));
    setSpeakingId(ok ? messageId : null);
    if (!ok) setChatError('当前设备不支持朗读或没有可朗读内容。');
  }

  return {
    input, setInput, streaming, streamingText, mockNotice, insufficientNotice, mediaNotice, mediaBusy, editingId, setEditingId,
    editDraft, setEditDraft, speakingId, busyId, sendMessage, cancelStreaming, regenerate, saveEdit,
    deleteFollowing, toggleSpeak, resetTurns, abortRequest, sendImage, sendAudio: (asset: {id:string;mimeType:string;size:number},caption:string) => saveAttachment({type:'AUDIO',assetId:asset.id,mimeType:asset.mimeType,byteSize:asset.size},caption), sendSticker: (stickerId: string) => saveAttachment({type: 'STICKER', stickerId}),
  };
}
