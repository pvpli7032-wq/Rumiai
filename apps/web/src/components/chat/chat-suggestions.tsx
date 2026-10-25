'use client';
import {useEffect, useRef, useState} from 'react';
import type {ChatSuggestionCapability, ChatSuggestionResult} from '@rumiai/contracts/conversations/suggestions';

export function ChatSuggestions({conversationId, token, disabled, onPick}: {conversationId: string; token: string; disabled: boolean; onPick: (text: string) => void}) {
  const [capability, setCapability] = useState<ChatSuggestionCapability | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const requestId = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const endpoint = '/api/conversations/' + encodeURIComponent(conversationId) + '/suggestions';
  useEffect(() => {
    const controller = new AbortController();
    setCapability(null); setSuggestions([]); setError('');
    fetch(endpoint, {signal: controller.signal, headers: {Authorization: 'Bearer ' + token}, cache: 'no-store'})
      .then(async response => {const body = await response.json(); if (!response.ok) throw Error(body.error || '接话建议状态读取失败。'); return body;})
      .then(body => {if (!controller.signal.aborted) setCapability(body);})
      .catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取失败，请重试。');});
    return () => {controller.abort(); request.current?.abort();};
  }, [endpoint, token, reload]);

  async function generate() {
    if (!capability?.available || disabled || busy.current) return;
    busy.current = true; setLoading(true); setError('');
    const id = requestId.current || crypto.randomUUID();
    requestId.current = id;
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch(endpoint, {method: 'POST', signal: controller.signal, headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify({requestId: id})});
      const body = await response.json();
      if (!response.ok) {
        if (response.status !== 409) requestId.current = null;
        if (response.status === 429) setCapability(previous => previous ? {...previous, available: false, reason: body.error} : previous);
        throw Error(body.error || '生成失败，请重试。');
      }
      const result = body as ChatSuggestionResult;
      requestId.current = null;
      setSuggestions(result.suggestions);
      setCapability(previous => previous ? {...previous, remaining: result.remaining, available: result.remaining > 0, reason: result.remaining ? null : '今天的接话建议次数已用完。'} : previous);
    } catch (cause) {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '连接中断，再次点击将检查同一批结果。');}
    finally {busy.current = false; if (!controller.signal.aborted) setLoading(false);}
  }

  return <section aria-label="接话建议" className="mx-auto mb-2 max-w-3xl space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled || loading || !capability?.available} onClick={() => void generate()} className="min-h-11 rounded-full border border-border px-3 text-sm text-foreground disabled:opacity-50">{loading ? '正在想一句…' : requestId.current ? '检查这批建议' : suggestions.length ? '换一批' : '帮我接一句'}</button>
      {capability?.available && <span className="text-xs text-muted-foreground">今日剩余 {capability.remaining} 次 · 只生成草稿（{new Date(capability.resetAt).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})} 重置）</span>}
      {capability?.reason && <span className="text-xs text-muted-foreground">{capability.reason}</span>}
      {!capability && !error && <span role="status" className="text-xs text-muted-foreground">正在读取建议状态…</span>}
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}{!capability && <button type="button" className="ml-2 min-h-11 text-brand" onClick={() => setReload(value => value + 1)}>重新读取</button>}</p>}
    {suggestions.length > 0 && <ul className="space-y-1">{suggestions.map((text, index) => <li key={index}><button type="button" disabled={disabled || loading} className="min-h-11 w-full rounded-xl bg-secondary/60 px-3 py-2 text-left text-sm leading-6 hover:bg-secondary disabled:opacity-50" onClick={() => onPick(text)}>{text}<span className="ml-2 text-xs text-muted-foreground">插入草稿</span></button></li>)}</ul>}
  </section>;
}
