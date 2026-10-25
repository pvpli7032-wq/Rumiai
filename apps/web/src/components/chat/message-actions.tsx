'use client';
import {useEffect, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Check, Copy, Flag, Heart, MoreHorizontal, Pencil, RotateCcw, Trash2, Volume2, VolumeX} from 'lucide-react';
import {plainText} from '@web/lib/rp-markup';
import {speechSupported, pauseSpeaking, resumeSpeaking} from '@web/lib/speech';
import {ChatPanelSheet} from './chat-panel-sheet';

type Props = {
  role: string; content: string; liked?: boolean; speaking?: boolean; busy?: boolean; disabled?: boolean;
  onLike?: () => void; onRegenerate?: () => void; onEdit?: () => void; onSpeak?: () => void; onReport?: () => void; onDelete?: () => void; extraActions?: ReactNode;
};
export function MessageActions({role, content, liked, speaking, busy, disabled, onLike, onRegenerate, onEdit, onSpeak, onReport, onDelete, extraActions}: Props) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {if (!speaking) setPaused(false);}, [speaking]);
  const [copied, setCopied] = useState(false), [notice, setNotice] = useState(''), [open, setOpen] = useState(false), [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reply = role !== 'USER';
  const button = 'inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40';
  const row = 'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] font-normal text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40';
  async function copy() {
    setNotice('');
    try {await navigator.clipboard.writeText(plainText(content)); setCopied(true); setTimeout(() => setCopied(false), 1500);}
    catch {setNotice('无法访问剪贴板，请长按文字后选择复制。');}
  }
  function act(action?: () => void) {setOpen(false); action?.();}
  return <div className="flex max-w-full flex-wrap items-center gap-0.5">
    {reply && onLike && <button type="button" className={button} aria-label={liked ? '取消消息点赞' : '点赞消息'} aria-pressed={liked} disabled={disabled || busy} onClick={onLike}><Heart size={16} className={liked ? 'fill-current text-brand' : ''} /></button>}
    {content && <button type="button" className={button} aria-label={copied ? '已复制' : '复制消息'} onClick={() => void copy()}>{copied ? <Check size={16} className="text-brand" /> : <Copy size={16} />}</button>}
    <button type="button" className={button} aria-label="更多消息操作" aria-expanded={open} onClick={() => setOpen(true)}><MoreHorizontal size={18} /></button>
    {notice && <p role="status" className="basis-full px-1 text-xs leading-5 text-muted-foreground">{notice}</p>}
    {mounted && createPortal(<ChatPanelSheet open={open} onClose={() => setOpen(false)} title="消息操作">
      <div className="space-y-1" onClickCapture={event => {if ((event.target as HTMLElement).closest('button[data-close-message-menu]')) setOpen(false);}}>
        {reply && onSpeak && speechSupported() && <button type="button" className={row} onClick={() => act(onSpeak)}>{speaking ? <VolumeX size={18} /> : <Volume2 size={18} />}{speaking ? '停止朗读' : '朗读这条回复'}</button>}
        {speaking && <button type="button" className={row} onClick={() => {if (paused) resumeSpeaking(); else pauseSpeaking(); setPaused(!paused);}}><Volume2 size={18}/>{paused ? '继续朗读' : '暂停朗读'}</button>}
        {reply && onRegenerate && <button type="button" className={row} disabled={disabled || busy} onClick={() => act(onRegenerate)}><RotateCcw size={18} />重新生成</button>}
        {!reply && onEdit && <button type="button" className={row} disabled={disabled || busy} onClick={() => act(onEdit)}><Pencil size={18} />编辑消息</button>}
        {extraActions}
        {reply && onReport && <button type="button" className={row} disabled={disabled} onClick={() => act(onReport)}><Flag size={18} />举报这条 AI 回复</button>}
        {onDelete && <button type="button" className={row + ' text-destructive'} disabled={disabled || busy} onClick={() => act(onDelete)}><Trash2 size={18} />删除此条及之后的消息</button>}
      </div>
    </ChatPanelSheet>, document.body)}
  </div>;
}
