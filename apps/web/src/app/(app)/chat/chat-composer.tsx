'use client';

import Link from 'next/link';
import { ImagePlus, Loader2, Send, Smile } from 'lucide-react';
import { useRef, useState } from 'react';
import { CHAT_STICKERS } from '@rumiai/contracts/api-types/conversations';
import { QuotaBar } from '@/components/chat/quota-bar';
import { StreamCancelRow } from '@/components/chat/stream-cancel';
import { ActionSuggestions } from '@/components/chat/action-suggestions';
import type { CompositionGuard } from '@/components/chat/chat-interaction';
import type { QuotaView, CancelPolicy } from '@web/lib/hooks/use-quota';
import type { Shortcut } from '@web/lib/preferences';

/** 输入区：额度行、余额不足提示、取消计费、错误与模拟提示、快捷语、场景建议、输入框。 */
export function ChatComposer({
  quota, quotaLoading, quotaError, onRetryQuota,
  insufficientNotice, streaming, streamingText, cancelPolicy, freeCancelRemaining, onCancel,
  chatError, mockNotice, mediaNotice, mediaBusy, shortcuts, activeScene, composer, input, setInput, streamingBusy,
  characterName, chatMaxChars, onSubmit, onSendImage, onSendSticker,
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
  mediaNotice: string;
  mediaBusy: boolean;
  shortcuts: Shortcut[];
  activeScene?: { suggestions: readonly { id: string; text: string }[] };
  composer: CompositionGuard;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  streamingBusy: boolean;
  characterName?: string;
  chatMaxChars?: number;
  onSubmit: (e: React.FormEvent) => void;
  onSendImage: (file: File, caption: string) => Promise<boolean>;
  onSendSticker: (stickerId: string) => Promise<boolean>;
}) {
  const [picker, setPicker] = useState<'emoji' | 'sticker' | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const emoji = ['😀','😂','🥰','😍','😭','😡','👍','🙏','❤️','✨','🎉','🤗'];
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
      {mediaNotice && <div role="status" className="mx-auto mb-3 max-w-3xl rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{mediaNotice}</div>}
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
      <div className="relative mx-auto mb-2 flex max-w-3xl items-center gap-2">
        <button type="button" aria-label="选择 emoji" onClick={() => setPicker(picker === 'emoji' ? null : 'emoji')} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"><Smile className="h-5 w-5" /></button>
        <button type="button" aria-label="选择表情包" onClick={() => setPicker(picker === 'sticker' ? null : 'sticker')} className="rounded-lg px-2 py-1.5 text-sm text-zinc-400 hover:bg-white/10 hover:text-white">表情包</button>
        <button type="button" aria-label="选择图片" onClick={() => fileInput.current?.click()} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"><ImagePlus className="h-5 w-5" /></button>
        <input ref={fileInput} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setImage(event.target.files?.[0] ?? null)} />
        {image && <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">待发送：{image.name}</span>}
        {image && <button type="button" onClick={() => setImage(null)} className="text-xs text-zinc-400 hover:text-white">移除</button>}
        {picker && <div className="absolute bottom-full left-0 z-20 mb-2 grid grid-cols-6 gap-1 rounded-xl border border-white/10 bg-zinc-900 p-2 shadow-xl">{picker === 'emoji' ? emoji.map(item => <button key={item} type="button" className="rounded p-2 text-xl hover:bg-white/10" onClick={() => { setInput(previous => previous + item); setPicker(null); }}>{item}</button>) : CHAT_STICKERS.map(item => <button key={item.id} type="button" aria-label={item.label} className="rounded p-2 text-3xl hover:bg-white/10 disabled:opacity-50" disabled={mediaBusy} onClick={async () => { if (await onSendSticker(item.id)) setPicker(null); }}>{item.glyph}</button>)}</div>}
      </div>
      <form onSubmit={async e => { if (!image) { onSubmit(e); return; } e.preventDefault(); if (await onSendImage(image, input.trim())) { setImage(null); setInput(''); } }} className="max-w-3xl mx-auto flex gap-3">
        <input
          {...composer.inputProps}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={streaming || mediaBusy}
          maxLength={chatMaxChars}
          placeholder={"发送消息给" + (characterName || '角色') + "..."}
          className="flex-1 px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-hidden focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all disabled:opacity-50"
        />
        {/* 图标按钮没有文字，必须给可访问名，否则读屏与自动化都点不到。 */}
        <button type="submit" aria-label={"发送"} disabled={streamingBusy || mediaBusy || (!input.trim() && !image)}
          className="p-3 bg-linear-to-br/srgb from-purple-600 to-pink-600 rounded-xl text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20">
          {streaming || mediaBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}
