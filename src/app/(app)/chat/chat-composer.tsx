'use client';

import Link from 'next/link';
import { Loader2, Send } from 'lucide-react';
import { QuotaBar } from '@/components/chat/quota-bar';
import { StreamCancelRow } from '@/components/chat/stream-cancel';
import { ActionSuggestions } from '@/components/chat/action-suggestions';
import type { CompositionGuard } from '@/components/chat/chat-interaction';
import type { QuotaView, CancelPolicy } from '@/lib/hooks/use-quota';
import type { Shortcut } from '@/lib/preferences';

/** 输入区：额度行、余额不足提示、取消计费、错误与模拟提示、快捷语、场景建议、输入框。 */
export function ChatComposer({
  quota, quotaLoading, quotaError, onRetryQuota,
  insufficientNotice, streaming, streamingText, cancelPolicy, freeCancelRemaining, onCancel,
  chatError, mockNotice, shortcuts, activeScene, composer, input, setInput, streamingBusy,
  characterName, chatMaxChars, onSubmit,
}: {
  quota: QuotaView | null;
  quotaLoading: boolean;
  quotaError: string;
  onRetryQuota: () => void;
  insufficientNotice: string;
  streaming: boolean;
  streamingText: string;
  cancelPolicy?: CancelPolicy;
  freeCancelRemaining?: number;
  onCancel: () => void;
  chatError: string | null;
  mockNotice: boolean;
  shortcuts: Shortcut[];
  activeScene?: { suggestions: readonly { id: string; text: string }[] };
  composer: CompositionGuard;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  streamingBusy: boolean;
  characterName?: string;
  chatMaxChars?: number;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="bg-zinc-900/80 border-t border-white/10 backdrop-blur-xs px-4 py-4">
      <QuotaBar quota={quota} loading={quotaLoading} error={quotaError} insufficient={Boolean(insufficientNotice)} onRetry={onRetryQuota} />
      {insufficientNotice && (
        <div role="alert" className="mx-auto mb-3 flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <span className="min-w-0 flex-1">{insufficientNotice}</span>
          <span className="text-xs text-amber-300/80">草稿已保留</span>
          <Link href="/shop" className="rounded-full border border-amber-400/40 px-2.5 py-1 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-400/20">
            去充值
          </Link>
        </div>
      )}
      {streaming && (
        <StreamCancelRow
          cancelPolicy={cancelPolicy}
          freeCancelRemaining={freeCancelRemaining}
          outputStarted={streamingText.length > 0}
          onCancel={onCancel}
        />
      )}
      {chatError && (
        <div role="alert" className="mx-auto mb-3 max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {chatError}
        </div>
      )}
      {mockNotice && (
        <div role="status" className="mx-auto mb-3 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          本轮为测试模拟回复，并非真实 AI 模型生成。
        </div>
      )}
      {shortcuts.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
          {shortcuts.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setInput(prev => (prev ? `${prev} ${s.text}` : s.text))}
              className="rounded-full border border-white/10 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-white/25 hover:text-white"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {activeScene && <div className="mx-auto mb-2 max-w-3xl"><ActionSuggestions suggestions={activeScene.suggestions} onPick={text => setInput(prev => prev ? prev + ' ' + text : text)} disabled={streaming} /></div>}
      <form onSubmit={onSubmit} className="max-w-3xl mx-auto flex gap-3">
        <input
          {...composer.inputProps}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={streaming}
          maxLength={chatMaxChars}
          placeholder={"发送消息给" + (characterName || '角色') + "..."}
          className="flex-1 px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-hidden focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all disabled:opacity-50"
        />
        {/* 图标按钮没有文字，必须给可访问名，否则读屏与自动化都点不到。 */}
        <button type="submit" aria-label={"发送"} disabled={streamingBusy || !input.trim()}
          className="p-3 bg-linear-to-br/srgb from-purple-600 to-pink-600 rounded-xl text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20">
          {streaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}
