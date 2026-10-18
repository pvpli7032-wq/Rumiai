'use client';
import { zhError } from '@/lib/copy/zh';

import { useEffect, useState } from 'react';
import { BookOpen, Ban, Zap, Plus, Trash2, Check } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  parseShortcuts, serialiseShortcuts, MAX_SHORTCUTS, MAX_SHORTCUT_LABEL, MAX_SHORTCUT_TEXT,
  type Shortcut,
} from '@/lib/preferences';

/**
 * The reader's own settings. All three already round-tripped through PUT /api/users/me but
 * nothing rendered them, so they were unreachable.
 */
export function ReaderPreferences() {
  const { token, refreshUser } = useAuth();
  const [readingMode, setReadingMode] = useState(false);
  const [bannedWords, setBannedWords] = useState('');
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch('/api/users/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const me = data?.user ?? data;
        if (!me) return;
        setReadingMode(Boolean(me.readingMode));
        setBannedWords(me.bannedWords ?? '');
        setShortcuts(parseShortcuts(me.shortcuts));
        setLoaded(true);
      })
      .catch(() => setError("设置加载失败"));
  }, [token]);

  async function save() {
    if (!token) return;
    setSaving(true);
    setError('');
    const res = await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reading_mode: readingMode,
        banned_words: bannedWords,
        shortcuts: serialiseShortcuts(shortcuts),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(zhError(body.error || '') || "保存失败");
      return;
    }
    await refreshUser();
    setNotice("阅读设置已保存");
    setTimeout(() => setNotice(''), 2500);
  }

  if (!loaded) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
        <span className="mx-auto block h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-5">
      <h2 className="mb-4 text-lg font-bold text-white">{"阅读设置"}</h2>

      {error && (
        <p className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Reading mode */}
      <button
        onClick={() => setReadingMode((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-zinc-800 px-3 py-3 text-left hover:border-white/25"
      >
        <span className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-zinc-400" />
          <span>
            <span className="block text-sm text-white">{"阅读模式"}</span>
            <span className="block text-xs text-zinc-500">{"放大文字，让长篇阅读更舒适"}</span>
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

      {/* Banned words */}
      <div className="mt-4">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-zinc-300">
          <Ban className="h-4 w-4 text-zinc-500" />
          {"屏蔽词"}</p>
        <p className="mb-2 text-xs text-zinc-500">
          {"每行一个词。含有这些词的回复将被折叠，点击仍可查看。"}</p>
        <textarea
          value={bannedWords}
          onChange={(e) => setBannedWords(e.target.value.slice(0, 4000))}
          rows={4}
          placeholder={"血腥\n暴力"}
          className="w-full resize-none rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-brand-strong/50 focus:outline-hidden"
        />
      </div>

      {/* Shortcuts */}
      <div className="mt-4">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-zinc-300">
          <Zap className="h-4 w-4 text-zinc-500" />
          {"聊天快捷短语"}</p>
        <p className="mb-2 text-xs text-zinc-500">
          {"点击填入常用句子（最多"}{MAX_SHORTCUTS})
        </p>

        <div className="space-y-2">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={s.label}
                onChange={(e) =>
                  setShortcuts((list) =>
                    list.map((item, j) =>
                      j === i ? { ...item, label: e.target.value.slice(0, MAX_SHORTCUT_LABEL) } : item
                    )
                  )
                }
                placeholder={"按钮名称"}
                className="w-28 shrink-0 rounded-xl border border-white/10 bg-zinc-800 px-2.5 py-2 text-xs text-white placeholder-zinc-600 focus:border-brand-strong/50 focus:outline-hidden"
              />
              <input
                value={s.text}
                onChange={(e) =>
                  setShortcuts((list) =>
                    list.map((item, j) =>
                      j === i ? { ...item, text: e.target.value.slice(0, MAX_SHORTCUT_TEXT) } : item
                    )
                  )
                }
                placeholder={"填入的文字"}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-zinc-800 px-2.5 py-2 text-xs text-white placeholder-zinc-600 focus:border-brand-strong/50 focus:outline-hidden"
              />
              <button
                onClick={() => setShortcuts((list) => list.filter((_, j) => j !== i))}
                aria-label={"删除快捷短语"}
                className="shrink-0 rounded-xl px-2 text-zinc-500 hover:bg-white/5 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {shortcuts.length < MAX_SHORTCUTS && (
          <button
            onClick={() => setShortcuts((list) => [...list, { label: '', text: '' }])}
            className="mt-2 flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
          >
            <Plus className="h-3.5 w-3.5" />
            {"添加快捷短语"}</button>
        )}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="mt-5 w-full rounded-xl bg-brand-gradient py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "正在保存…" : "保存设置"}
      </button>

      {notice && (
        <p className="mt-2 flex items-center justify-center gap-1 text-xs text-emerald-400">
          <Check className="h-3 w-3" />
          {notice}
        </p>
      )}
    </div>
  );
}
