'use client';

import { useEffect, useState } from 'react';

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
export function useConversationPanel(conversationId: string, token: string) {
  const [state, setState] = useState<ConversationState | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [notes, setNotes] = useState('');
  const [savedNotes, setSavedNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let alive = true;
    setModels([]);
    setModelsLoaded(false);
    Promise.all([
      fetch(`/api/conversations/${conversationId}`, { headers }).then((r) => (r.ok ? r.json() : null)),
      // 可选模型来自服务端维护的路由目录。
      fetch(`/api/ai/models?conversationId=${encodeURIComponent(conversationId)}`, { headers }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([conv, modelList]) => {
        if (!alive) return;
        if (conv?.conversation) {
          setState(conv.conversation);
          setNotes(conv.conversation.notes ?? '');
          setSavedNotes(conv.conversation.notes ?? '');
        }
        if (modelList?.models) {
          setModelsLoaded(true);
          setModels(modelList.models);
          setModelLabels(modelList.labels ?? {});
          setDefaultModel(modelList.default ?? null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // headers 每次渲染都是新对象，依赖只认会话与令牌。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, token]);

  async function patch(body: Record<string, unknown>, message?: string) {
    setSaving(true);
    const res = await fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setNotice('保存失败');
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (data.conversation) setState((s) => (s ? { ...s, ...data.conversation } : s));
    if (message) setNotice(message);
    return data.conversation;
  }

  return { state, models, modelLabels, defaultModel, modelsLoaded, notes, setNotes, savedNotes, setSavedNotes, saving, notice, patch };
}
