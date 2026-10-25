'use client';
import {useCallback, useEffect, useState} from 'react';
import {api} from '@web/lib/api-client';
import type {ConversationToolSettings} from '@rumiai/contracts/conversations/context-tools';
export function useConversationTools(conversationId: string | null, token: string | null) {
  const [data, setData] = useState<ConversationToolSettings | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    setData(null); setError('');
    if (!conversationId || !token) return;
    const controller = new AbortController();
    void api.get<ConversationToolSettings>('/api/conversations/' + encodeURIComponent(conversationId) + '/context', {token, signal: controller.signal}).then(setData).catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '对话设置读取失败。');});
    return () => controller.abort();
  }, [conversationId, token, revision]);
  async function save(settings: ConversationToolSettings['settings']) {
    if (!conversationId || !token || busy) return false;
    setBusy(true); setError('');
    try {setData(await api.patch<ConversationToolSettings>('/api/conversations/' + conversationId + '/context', settings, {token})); return true;}
    catch (cause) {setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); return false;}
    finally {setBusy(false);}
  }
  return {data, error, busy, reload, save};
}
