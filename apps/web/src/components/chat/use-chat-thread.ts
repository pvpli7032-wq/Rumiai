'use client';

import { useEffect, useState, type RefObject } from 'react';
import { zhError } from '@rumiai/contracts/copy/zh';
import { notifyChatListChanged } from '@rumiai/contracts/conversations/chat-events';
import { fetchEarlierMessagePage, fetchLatestMessagePage, refetchPageSize } from '@web/lib/conversations/message-history-client';
import type { ChatMessage as Message } from '@rumiai/contracts/api-types/conversations';
import type { Character } from './character-avatar';

/** 一页消息：最新一页与更早一页的形状一致，应用方式也只有 applyLatestPage 一份。 */
export interface MessagePage { messages: Message[]; hasMore: boolean; nextCursor: string | null }

/**
 * 会话线程：取角色与会话、最新一页消息、往前翻页、点赞。
 * 不涉及发送与流式输出（在 use-chat-turns），也不含 JSX。
 */
export function useChatThread(opts: {
  charId: string | null;
  token: string | null;
  authLoading: boolean;
  requestedConversation: string | null;
  wantsNewChat: boolean;
  router: { push: (href: string) => void };
  chatScroll: { skipNextFollow: () => void };
  messageListRef: RefObject<HTMLDivElement | null>;
  requireLogin: () => void;
}) {
  const { charId, token, authLoading, requestedConversation, wantsNewChat, router, chatScroll, messageListRef, requireLogin } = opts;
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);

  /** 首屏/重新对齐：用最新一页替换整段，并重置分页游标。 */
  function applyLatestPage(page: MessagePage) {
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
      chatScroll.skipNextFollow();
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

  async function reloadMessages(signal?: AbortSignal) {
    if (!conversationId) return;
    const fresh = await fetchLatestMessagePage(token!, conversationId, refetchPageSize(messages.length), signal);
    if (!signal?.aborted && fresh) applyLatestPage(fresh);
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

  useEffect(() => {
    if (!charId) { setLoading(false); return; }
    // The provider restores the token from localStorage in its own effect, so on the
    // first pass token is still null even for a signed-in user. Deciding here before
    // that settles bounced people straight back to the login page.
    if (authLoading) return;
    // Carry where they were headed, so signing in lands on this chat and not the
    // marketing page.
    if (!token) { setLoading(false); requireLogin(); return; }

    const headers = { Authorization: `Bearer ${token}` };
    const loadJSON = async (response: Response) => { const data = await response.json(); if (!response.ok) throw Error(zhError(data.error || '')); return data; };
    let active = true;
    setLoading(true); setChatError(null); setCharacter(null); setConversationId(null); setMessages([]);
    Promise.all([
      fetch(`/api/characters/${charId}`, { headers }).then(loadJSON),
      (requestedConversation ? fetch('/api/conversations/'+encodeURIComponent(requestedConversation),{headers}) : fetch('/api/conversations', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: charId, newChat: wantsNewChat }) })).then(loadJSON),
    ]).then(([charData, convData]) => {
      if (!active) return;
      if (charData.character) setCharacter(charData.character);
      if (convData.conversation) {
        setConversationId(convData.conversation.id);
        // A brand new room did not exist when the sidebar last loaded.
        notifyChatListChanged();
        return fetchLatestMessagePage(token, convData.conversation.id);
      }
    }).then(page => {
      if (active && page) applyLatestPage(page);
    }).catch(error => { if (active) setChatError(error.message || '无法加载对话，请重试。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // requireLogin 与 applyLatestPage 每次渲染都是新引用，依赖只认输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId, token, authLoading, requestedConversation, wantsNewChat]);

  return {
    character, messages, setMessages, conversationId, likedIds, hasEarlier, loadingEarlier,
    loading, chatError, setChatError, setLoading, applyLatestPage, loadEarlierMessages,
    reloadMessages, toggleMessageLike, router,
  };
}
