'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { DesignIcon } from '@/components/primitives/design-icon';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {ChatPanelSheet} from './chat-panel-sheet';
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
  characterName, chatMaxChars, mediaTools, suggestionTools, sendKey = 'enter', onSubmit, onSendImage, onSendSticker,
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
  mediaTools?: ReactNode;
  suggestionTools?: ReactNode;
  sendKey?: 'enter' | 'modifier-enter';
  onSubmit: (e: React.FormEvent) => void;
  onSendImage: (file: File, caption: string) => Promise<boolean>;
  onSendSticker: (stickerId: string) => Promise<boolean>;
}) {
  const [attachmentsOpen,setAttachmentsOpen]=useState(false);
  const [picker, setPicker] = useState<'emoji' | 'sticker' | null>(null);
  const [stickers,setStickers]=useState<Array<{id:string;label:string;glyph:string}>>([]);
  const [stickerError,setStickerError]=useState('');
  const [stickerLoading,setStickerLoading]=useState(false);
  async function loadStickers(){setStickerLoading(true);setStickerError('');try{const response=await fetch('/api/chat/stickers',{cache:'no-store'});if(!response.ok)throw Error('表情包加载失败');setStickers(await response.json());}catch{setStickerError('表情包加载失败，请重试。');}finally{setStickerLoading(false);}}
  useEffect(()=>{if(picker==='sticker')void loadStickers();},[picker]);
  const [image, setImage] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const element = textInput.current; if (!element) return; element.style.height = 'auto'; element.style.height = Math.min(element.scrollHeight, 160) + 'px'; }, [input]);
  const emoji = ['😀','😂','🥰','😍','😭','😡','👍','🙏','❤️','✨','🎉','🤗'];
  return (
    <>
    <div className="max-h-[50dvh] shrink-0 overflow-y-auto border-t border-border bg-background px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      <QuotaBar quota={quota} loading={quotaLoading} error={quotaError} insufficient={Boolean(insufficientNotice)} onRetry={onRetryQuota} />
      {insufficientNotice && (
        <div role="alert" className="mx-auto mb-3 flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
          <span className="min-w-0 flex-1">{insufficientNotice}</span>
          <span className="text-xs text-muted-foreground">草稿已保留</span>
          <Link href="/shop" className="rounded-full border border-amber-400/40 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-amber-400/20">
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
        <div role="alert" className="mx-auto mb-3 max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-destructive">
          {chatError}
        </div>
      )}
      {mockNotice && (
        <div role="status" className="mx-auto mb-3 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
          本轮为测试模拟回复，并非真实 AI 模型生成。
        </div>
      )}
      {mediaNotice && <div role="status" className="mx-auto mb-3 max-w-3xl rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-foreground">{mediaNotice}</div>}
      {shortcuts.length > 0 && (
        <details className="mx-auto mb-2 max-w-3xl"><summary className="min-h-11 cursor-pointer py-3 text-xs text-muted-foreground">快捷语</summary><div className="flex gap-2 overflow-x-auto pb-1">
          {shortcuts.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setInput(prev => (prev ? `${prev} ${s.text}` : s.text))}
              className="min-h-11 shrink-0 rounded-full bg-secondary px-3 text-xs text-foreground hover:border-brand/40 hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div></details>
      )}
      {activeScene && <div className="mx-auto mb-2 max-w-3xl"><ActionSuggestions suggestions={activeScene.suggestions} onPick={text => setInput(prev => prev ? prev + ' ' + text : text)} disabled={streaming} /></div>}
      <div className="relative mx-auto mb-1 flex max-w-3xl flex-wrap items-center gap-1">
        <button type="button" aria-label="选择 emoji" onClick={() => setPicker(picker === 'emoji' ? null : 'emoji')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><DesignIcon name="ph:smiley" size={20} /></button>
        <button type="button" aria-label="选择表情包" onClick={() => setPicker(picker === 'sticker' ? null : 'sticker')} className="min-h-11 rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">表情包</button>
        <button type="button" aria-label="附件工具" onClick={() => setAttachmentsOpen(true)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><DesignIcon name="ph:plus" size={20} /></button>
        <input ref={fileInput} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setImage(event.target.files?.[0] ?? null)} />
        {image && <span className="min-w-0 flex-1 truncate text-xs text-foreground">待发送：{image.name}</span>}
        {image && <button type="button" onClick={() => setImage(null)} className="min-h-11 px-2 text-xs text-muted-foreground hover:text-foreground">移除</button>}
        {picker==='sticker'&&stickerLoading&&<p role="status" className="w-full py-3 text-sm text-muted-foreground">正在加载表情…</p>}
        {picker==='sticker'&&stickerError&&<button type="button" className="min-h-11 text-sm" onClick={()=>void loadStickers()}>{stickerError}</button>}
        {picker==='sticker'&&!stickerLoading&&!stickerError&&!stickers.length&&<p className="w-full py-3 text-sm text-muted-foreground">暂无上架表情</p>}
        {picker && <div className="order-first z-20 mb-2 grid w-full grid-cols-6 gap-1 rounded-xl border border-border bg-card p-2 shadow-xl">{picker === 'emoji' ? emoji.map(item => <button key={item} type="button" className="rounded p-2 text-xl hover:bg-secondary" onClick={() => { setInput(previous => previous + item); setPicker(null); }}>{item}</button>) : stickers.map(item => <button key={item.id} type="button" aria-label={item.label} className="rounded p-2 text-3xl hover:bg-secondary disabled:opacity-50" disabled={mediaBusy} onClick={async () => { if (await onSendSticker(item.id)) setPicker(null); }}>{item.glyph}</button>)}</div>}
      </div>
      <form onSubmit={async e => { if (!image) { onSubmit(e); return; } e.preventDefault(); if (await onSendImage(image, input.trim())) { setImage(null); setInput(''); } }} className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          {...composer.inputProps}
          ref={textInput}
          rows={1}
          aria-label="消息内容"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={event => { composer.inputProps.onKeyDown(event); if (event.key === 'Enter' && !event.shiftKey && !event.defaultPrevented && !event.nativeEvent.isComposing && (sendKey === 'modifier-enter' ? event.ctrlKey || event.metaKey : !window.matchMedia('(pointer: coarse)').matches)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
          disabled={streaming || mediaBusy}
          maxLength={chatMaxChars}
          placeholder={"发送消息给" + (characterName || '角色') + "..."}
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-border bg-card px-4 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-ring/30 transition-all motion-reduce:transition-none disabled:opacity-50"
        />
        {/* 图标按钮没有文字，必须给可访问名，否则读屏与自动化都点不到。 */}
        <button type="submit" aria-label={"发送"} disabled={streamingBusy || mediaBusy || (!input.trim() && !image)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
          {streaming || mediaBusy ? <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" /> : <DesignIcon name="ph:paper-plane-tilt-fill" size={20} />}
        </button>
      </form>
    </div>
    <ChatPanelSheet open={attachmentsOpen} onClose={()=>setAttachmentsOpen(false)} title="附件工具">{attachmentsOpen&&<div className="space-y-5"><button type="button" onClick={()=>{fileInput.current?.click();setAttachmentsOpen(false);}} className="min-h-11 rounded-full border border-border px-4 text-sm">发送图片</button>{suggestionTools&&<details><summary className="min-h-11 cursor-pointer py-3 text-sm">接话建议</summary>{suggestionTools}</details>}{mediaTools}</div>}</ChatPanelSheet>
    </>
  );
}
