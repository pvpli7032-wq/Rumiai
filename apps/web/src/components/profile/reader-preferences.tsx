'use client';
import {NotificationPreferences} from './notification-preferences';
import {DEFAULT_READER_PREFERENCES, normalizeReaderPreferences, type ReaderPreferences as ReaderPreferenceValues} from '@rumiai/contracts/accounts/preferences';
import { zhError } from '@rumiai/contracts/copy/zh';

import { useEffect, useState } from 'react';
import { BookOpen, Ban, Zap, Plus, Trash2, Check } from 'lucide-react';
import { useAuth } from '@web/lib/auth-context';
import {
  parseShortcuts, serialiseShortcuts, MAX_SHORTCUTS, MAX_SHORTCUT_LABEL, MAX_SHORTCUT_TEXT,
  type Shortcut,
} from '@web/lib/preferences';

/**
 * The reader's own settings. All three already round-tripped through PUT /api/users/me but
 * nothing rendered them, so they were unreachable.
 */
export function ReaderPreferences() {
  const { token, refreshUser } = useAuth();
  const [readingMode, setReadingMode] = useState(false);
  const [preferences, setPreferences] = useState<ReaderPreferenceValues>({...DEFAULT_READER_PREFERENCES});
  const [shortcutPreview, setShortcutPreview] = useState('');
  const [bannedWords, setBannedWords] = useState('');
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    setLoadError('');
    setError('');
    setNotice('');
    if (!token) return () => controller.abort();
    async function load() {
      try {
        const response = await fetch('/api/users/me', {
          headers: {Authorization: `Bearer ${token}`},
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(zhError(data.error || '') || '阅读设置加载失败，请重试。');
        const me = data?.user ?? data;
        if (!me || typeof me !== 'object') throw new Error('阅读设置返回异常，请重试。');
        if (controller.signal.aborted) return;
        setReadingMode(Boolean(me.readingMode));
        setPreferences(normalizeReaderPreferences(me.readerPreferences, me.readingMode));
        setBannedWords(me.bannedWords ?? '');
        setShortcuts(parseShortcuts(me.shortcuts));
        setLoaded(true);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setLoadError(cause instanceof TypeError ? '网络连接失败，请重试。' : (cause as Error).message);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [token, reloadToken]);

  async function save() {
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reading_mode: readingMode,
        readerPreferences: preferences,
        banned_words: bannedWords,
        shortcuts: serialiseShortcuts(shortcuts),
      }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(zhError(body.error || '') || '保存失败');
      }
      await refreshUser();
      setNotice("阅读设置已保存");
      setTimeout(() => setNotice(''), 2500);
    } catch (cause) {
      setError(cause instanceof TypeError ? '网络连接失败，请重试。' : (cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!token) return null;

  if (!loaded && loadError) {
    return <section className="rounded-2xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">阅读设置</h2><p role="alert" className="mt-3 text-sm text-muted-foreground">{loadError}</p><button type="button" onClick={() => setReloadToken(value => value + 1)} className="mt-3 min-h-11 rounded-full border border-border px-4 text-sm">重新加载</button></section>;
  }

  if (!loaded) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <span role="status" aria-label="正在加载阅读设置" className="mx-auto block h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 text-lg font-semibold text-foreground">{"阅读设置"}</h2>

      {error && (
        <p className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Reading mode */}
      <button
        onClick={() => {setReadingMode(value => !value); setPreferences(value => ({...value, fontSize: readingMode ? 'standard' : 'large'}));}}
        aria-label="阅读模式"
        aria-pressed={readingMode}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/30 px-3 py-3 text-left hover:border-brand/30"
      >
        <span className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-zinc-400" />
          <span>
            <span className="block text-sm text-foreground">{"阅读模式"}</span>
            <span className="block text-xs text-muted-foreground">{"放大文字，让长篇阅读更舒适"}</span>
          </span>
        </span>
        <span
          className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
            readingMode ? 'justify-end bg-brand-strong' : 'justify-start bg-zinc-600'
          }`}
        >
          <span className="h-5 w-5 rounded-full bg-white" />
        </span>
      </button>


      <details className="mt-4 rounded-xl border border-border p-3"><summary className="min-h-8 cursor-pointer text-sm">字体、排版与交互偏好</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">字号<select aria-label="聊天字号" className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3" value={preferences.fontSize} onChange={event => {const fontSize=event.target.value as ReaderPreferenceValues['fontSize'];setPreferences(value=>({...value,fontSize}));setReadingMode(fontSize!=='standard');}}><option value="standard">标准</option><option value="large">大</option><option value="larger">更大</option></select></label>
        <label className="text-sm">行距<select aria-label="聊天行距" className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3" value={preferences.lineSpacing} onChange={event=>setPreferences(value=>({...value,lineSpacing:event.target.value as ReaderPreferenceValues['lineSpacing']}))}><option value="standard">标准</option><option value="relaxed">舒展</option></select></label>
        <label className="text-sm">消息样式<select aria-label="消息样式" className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3" value={preferences.bubbleStyle} onChange={event=>setPreferences(value=>({...value,bubbleStyle:event.target.value as ReaderPreferenceValues['bubbleStyle']}))}><option value="soft">柔和气泡</option><option value="plain">简洁文本</option></select></label>
        <label className="text-sm">回复展示<select aria-label="回复展示方式" className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3" value={preferences.streamDisplayMode} onChange={event=>setPreferences(value=>({...value,streamDisplayMode:event.target.value as ReaderPreferenceValues['streamDisplayMode']}))}><option value="stream">逐步显示</option><option value="complete">完成后显示</option></select></label>
        <label className="text-sm">发送快捷键<select aria-label="发送快捷键" className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3" value={preferences.sendKey} onChange={event=>setPreferences(value=>({...value,sendKey:event.target.value as ReaderPreferenceValues['sendKey']}))}><option value="enter">Enter 发送，Shift+Enter 换行</option><option value="modifier-enter">Ctrl / ⌘ + Enter 发送</option></select></label>
        <label className="text-sm">朗读速度<select aria-label="朗读速度" className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3" value={preferences.speechRate} onChange={event=>setPreferences(value=>({...value,speechRate:Number(event.target.value) as ReaderPreferenceValues['speechRate']}))}>{[0.75,1,1.25,1.5].map(rate=><option value={rate} key={rate}>{rate} 倍</option>)}</select></label>
      </div>
      <div aria-label="阅读效果预览" className={'mt-4 p-4 '+(preferences.bubbleStyle==='soft'?'rounded-2xl bg-muted/40':'border-l-2 border-border')+' '+(preferences.fontSize==='larger'?'text-xl':preferences.fontSize==='large'?'text-lg':'text-base')+' '+(preferences.lineSpacing==='relaxed'?'leading-loose':'leading-relaxed')}>“今天想聊一点什么？”<br/>你可以慢慢想，我会认真听。</div>
      <button type="button" onClick={()=>{setPreferences({...DEFAULT_READER_PREFERENCES});setReadingMode(false);}} className="mt-2 min-h-11 text-sm text-muted-foreground underline">恢复阅读偏好默认值</button>
      </details>

      {/* Banned words */}
      <div className="mt-4">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Ban className="h-4 w-4 text-muted-foreground" />
          {"屏蔽词"}</p>
        <p className="mb-2 text-xs text-muted-foreground">
          {"每行一个词。含有这些词的回复将被折叠，点击仍可查看。"}</p>
        <textarea
          value={bannedWords}
          onChange={(e) => setBannedWords(e.target.value.slice(0, 4000))}
          rows={4}
          placeholder={"血腥\n暴力"}
          className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand-strong/50 focus:outline-hidden"
        />
      </div>

      {/* Shortcuts */}
      <div className="mt-4">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Zap className="h-4 w-4 text-muted-foreground" />
          {"聊天快捷短语"}</p>
        <p className="mb-2 text-xs text-muted-foreground">
          {"点击填入常用句子（最多"}{MAX_SHORTCUTS})
        </p>

        <div className="space-y-2">
          {shortcuts.map((s, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl border border-border p-3">
              <input
                value={s.label}
                aria-label="快捷短语名称"
                onChange={(e) =>
                  setShortcuts((list) =>
                    list.map((item, j) =>
                      j === i ? { ...item, label: e.target.value.slice(0, MAX_SHORTCUT_LABEL) } : item
                    )
                  )
                }
                placeholder={"按钮名称"}
                className="col-span-2 min-h-11 min-w-0 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand-strong/50 focus:outline-hidden"
              />
              <input
                value={s.text}
                aria-label="快捷短语内容"
                onChange={(e) =>
                  setShortcuts((list) =>
                    list.map((item, j) =>
                      j === i ? { ...item, text: e.target.value.slice(0, MAX_SHORTCUT_TEXT) } : item
                    )
                  )
                }
                placeholder={"填入的文字"}
                className="col-span-2 min-h-11 min-w-0 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand-strong/50 focus:outline-hidden"
              />
              <div className="flex flex-wrap gap-2"><button type="button" aria-label={'上移快捷语 '+(i+1)} disabled={i===0} className="min-h-11 px-3 text-xs disabled:opacity-30" onClick={()=>setShortcuts(list=>{const next=[...list];[next[i-1],next[i]]=[next[i],next[i-1]];return next;})}>上移</button><button type="button" aria-label={'下移快捷语 '+(i+1)} disabled={i===shortcuts.length-1} className="min-h-11 px-3 text-xs disabled:opacity-30" onClick={()=>setShortcuts(list=>{const next=[...list];[next[i],next[i+1]]=[next[i+1],next[i]];return next;})}>下移</button></div>
              <button
                onClick={() => setShortcuts((list) => list.filter((_, j) => j !== i))}
                aria-label={"删除快捷短语"}
                className="min-h-11 min-w-11 rounded-xl px-3 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {shortcuts.length < MAX_SHORTCUTS && (
          <button
            onClick={() => setShortcuts((list) => [...list, { label: '', text: '' }])}
            className="mt-2 flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            {"添加快捷短语"}</button>
        )}
      </div>

      {shortcuts.some(item=>item.label.trim()&&item.text.trim())&&<div className="mt-4 rounded-xl border border-border p-3" aria-label="快捷语预览"><p className="text-sm font-medium">快捷语预览</p><div className="mt-2 flex flex-wrap gap-2">{shortcuts.filter(item=>item.label.trim()&&item.text.trim()).map((item,index)=><button type="button" key={index} className="min-h-11 rounded-full border border-border px-3 text-sm" onClick={()=>setShortcutPreview(item.text)}>{item.label}</button>)}</div>{shortcutPreview&&<p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{shortcutPreview}</p>}</div>}
      <button
        onClick={save}
        disabled={saving}
        className="mt-5 w-full rounded-xl bg-brand-strong py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "正在保存…" : "保存设置"}
      </button>

      {notice && (
        <p className="mt-2 flex items-center justify-center gap-1 text-xs text-emerald-400">
          <Check className="h-3 w-3" />
          {notice}
        </p>
      )}
      <NotificationPreferences />
    </div>
  );
}
