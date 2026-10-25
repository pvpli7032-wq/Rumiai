'use client';

import {useEffect, useRef, useState} from 'react';
import {CHAT_LIST_CHANGED} from '@rumiai/contracts/conversations/chat-events';
import type {RelationshipPolicy} from '@rumiai/contracts/conversations/relationship';

export interface ConversationState {
  id: string;
  title: string;
  relationshipStatus?: string | null;
  romance: number;
  intimacy: number;
  notes?: string | null;
  archivedAt?: string | null;
  relationshipMode: boolean;
  aiModel?: string | null;
  messageCount: number;
  daysChatting: number;
  character?: {
    id: string;
    name: string;
    tagline?: string | null;
    avatarUrl?: string | null;
    roleTemplate?: string | null;
    scenario?: string | null;
  } | null;
}

/**
 * 会话侧栏的数据层：读取会话状态与可选模型，并把 PATCH 的结果合并回本地状态。
 * 渲染在 relationship-panel.tsx，这里只负责取数与写回。
 */
export interface RelationshipHistoryItem {
  id: string; messageId: string | null; romanceDelta: number; intimacyDelta: number;
  romanceAfter: number; intimacyAfter: number; createdAt: string;
}
export function useConversationPanel(conversationId: string, token: string) {
  const [state, setState] = useState<ConversationState | null>(null);
  const [policy, setPolicy] = useState<RelationshipPolicy | null>(null);
  const [history, setHistory] = useState<RelationshipHistoryItem[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const [modelQuotes, setModelQuotes] = useState<Record<string, {coins: number; pricing: string}>>({});
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [notes, setNotes] = useState('');
  const [savedNotes, setSavedNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const busy = useRef(false);
  const activeConversation = useRef(conversationId);
  activeConversation.current = conversationId;

  useEffect(() => {
    const controller = new AbortController();
    setState(null); setPolicy(null); setHistory([]); setModels([]); setModelQuotes({}); setModelsLoaded(false); setError(''); setNotice(''); setSaving(false);
    const headers = {Authorization: 'Bearer ' + token};
    void fetch('/api/conversations/' + encodeURIComponent(conversationId), {headers, signal: controller.signal})
      .then(async response => {const data = await response.json(); if (!response.ok) throw Error(data.error || '关系资料读取失败。'); return data;})
      .then(data => {
        if (controller.signal.aborted) return;
        setState(data.conversation); setPolicy(data.relationshipPolicy ?? null); setHistory(data.relationshipHistory ?? []);
        setNotes(data.conversation.notes ?? ''); setSavedNotes(data.conversation.notes ?? '');
      }).catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '关系资料读取失败。');});
    void fetch('/api/ai/models?conversationId=' + encodeURIComponent(conversationId), {headers, signal: controller.signal})
      .then(async response => {const data = await response.json(); if (!response.ok) throw Error(data.error || '模型列表读取失败。'); return data;})
      .then(data => {
        if (controller.signal.aborted) return;
        setModels(data.models ?? []); setModelQuotes(data.quotes ?? {}); setModelLabels(data.labels ?? {}); setDefaultModel(data.default ?? null); setModelsLoaded(true);
      }).catch(cause => {if (!controller.signal.aborted) {setNoticeError(true); setNotice(cause instanceof Error ? cause.message : '模型列表读取失败。');}});
    return () => controller.abort();
  }, [conversationId, token, revision]);

  useEffect(() => {
    const controller = new AbortController();
    let refreshNumber = 0;
    const refresh = () => {
      const current = ++refreshNumber;
      void fetch('/api/ai/models?conversationId=' + encodeURIComponent(conversationId), {headers: {Authorization: 'Bearer ' + token}, signal: controller.signal})
        .then(async response => {const data = await response.json(); if (!response.ok) throw Error(data.error || '模型报价刷新失败。'); return data;})
        .then(data => {if (!controller.signal.aborted && current === refreshNumber) {setModels(data.models ?? []); setModelLabels(data.labels ?? {}); setModelQuotes(data.quotes ?? {}); setDefaultModel(data.default ?? null); setModelsLoaded(true);}})
        .catch(cause => {if (!controller.signal.aborted) {setModelQuotes({}); setNoticeError(true); setNotice(cause instanceof Error ? cause.message : '模型报价刷新失败。');}});
      void fetch('/api/conversations/' + encodeURIComponent(conversationId), {headers: {Authorization: 'Bearer ' + token}, signal: controller.signal})
        .then(async response => {const data = await response.json(); if (!response.ok) throw Error(data.error || '关系状态刷新失败。'); return data;})
        .then(data => {
          if (controller.signal.aborted || current !== refreshNumber) return;
          setState(data.conversation); setPolicy(data.relationshipPolicy ?? null); setHistory(data.relationshipHistory ?? []);
        }).catch(cause => {if (!controller.signal.aborted) {setNoticeError(true); setNotice(cause instanceof Error ? cause.message : '关系状态刷新失败。');}});
    };
    window.addEventListener(CHAT_LIST_CHANGED, refresh);
    return () => {controller.abort(); window.removeEventListener(CHAT_LIST_CHANGED, refresh);};
  }, [conversationId, token]);

  async function patch(body: Record<string, unknown>, message?: string) {
    if (busy.current) return null;
    busy.current = true; setSaving(true); setNotice(''); setNoticeError(false);
    const targetId = conversationId;
    try {
      const response = await fetch('/api/conversations/' + encodeURIComponent(targetId), {
        method: 'PATCH', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || '保存失败，请重试。');
      if (activeConversation.current !== targetId) return null;
      if (data.conversation) setState(current => current ? {...current, ...data.conversation} : current);
      if (data.relationshipPolicy) setPolicy(data.relationshipPolicy);
      if (data.relationshipHistory) setHistory(data.relationshipHistory);
      setNotice(message ?? '已保存');
      return data.conversation;
    } catch (cause) {
      if (activeConversation.current === targetId) {setNoticeError(true); setNotice(cause instanceof Error ? cause.message : '网络连接失败，请重试。');}
      return null;
    } finally {busy.current = false; if (activeConversation.current === targetId) setSaving(false);}
  }

  return {state, policy, history, models, modelLabels, modelQuotes, defaultModel, modelsLoaded, notes, setNotes, savedNotes, setSavedNotes,
    saving, notice, noticeError, error, retry: () => setRevision(value => value + 1), patch};
}
