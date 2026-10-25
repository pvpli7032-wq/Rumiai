'use client';

import { Pencil, Volume2, VolumeX, Check, Trash2, MoreHorizontal } from 'lucide-react';
import { DesignIcon } from '@/components/primitives/design-icon';
import { useEffect, useRef, useState } from 'react';
import { speechSupported } from '@web/lib/speech';
import { plainText } from '@web/lib/rp-markup';

/**
 * The controls that hang off a message bubble. They stay hidden until the bubble is
 * hovered, so a long thread reads as prose rather than as rows of buttons — except for a
 * like that is already set, which has to stay visible to show its state.
 */
export function MessageActions({
  role,
  content,
  liked,
  speaking,
  busy,
  disabled,
  onLike,
  onRegenerate,
  onEdit,
  onSpeak,
  onReport,
  onDelete,
}: {
  role: 'USER' | 'ASSISTANT' | string;
  content: string;
  liked?: boolean;
  speaking?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onLike?: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
  onSpeak?: () => void;
  onReport?: () => void;
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const isReply = role !== 'USER';
  const menu = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMoreActions = Boolean(onSpeak || onRegenerate || onReport || onDelete || onEdit);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {if (event.target instanceof Node && !menu.current?.contains(event.target) && menu.current) menu.current.open = false;};
    const escape = (event: KeyboardEvent) => {if (event.key === 'Escape' && menu.current) {menu.current.open = false; menu.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);};
  }, [menuOpen]);

  async function copy() {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(plainText(content));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError('无法访问剪贴板，请长按或选中文字后复制。');
    }
  }

  return (
    <div className="flex max-w-full shrink-0 flex-wrap items-center gap-0.5">
      {isReply && onLike && (
        <Action
          label={liked ? "取消消息点赞" : "点赞消息"}
          onClick={onLike}
          // A set like must not fade out with the rest, or its state is invisible.
          alwaysVisible={liked}
          className={liked ? 'text-brand' : ''}
        >
          <DesignIcon name="ph:heart-straight" size={16} className={liked ? 'fill-current' : ''} />
        </Action>
      )}

      <Action label={copied ? "已复制" : "复制消息"} onClick={copy} alwaysVisible={copied}>
        {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <DesignIcon name="ph:copy" size={16} />}
      </Action>

      {/* Native long-press text selection stays on the bubble; this explicit menu never captures its pointer events. */}
      {hasMoreActions && <details ref={menu} onToggle={event => setMenuOpen(event.currentTarget.open)} className="relative"><summary aria-label="更多消息操作" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><MoreHorizontal className="h-4 w-4" /></summary><div className="absolute right-0 z-30 flex min-w-48 flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-2 shadow-lg" role="group" aria-label="消息操作">
      {isReply && onSpeak && speechSupported() && (
        <Action
          label={speaking ? "停止朗读" : "朗读"}
          onClick={onSpeak}
          alwaysVisible={speaking}
          className={speaking ? 'text-brand-strong' : ''}
        >
          {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </Action>
      )}

      {isReply && onRegenerate && (
        <Action label={"重新生成"} onClick={onRegenerate} disabled={disabled || busy}>
          <DesignIcon name="ph:arrows-clockwise" size={16} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} />
        </Action>
      )}

      {isReply && onReport && <Action label="举报这条 AI 回复" onClick={onReport} disabled={disabled}><DesignIcon name="ph:flag" size={16} /></Action>}

      {onDelete && <Action label="删除此条及之后的消息" onClick={onDelete} disabled={disabled || busy}><Trash2 className="h-3.5 w-3.5" /></Action>}

      {!isReply && onEdit && (
        <Action label={"编辑消息"} onClick={onEdit} disabled={disabled || busy}>
          <Pencil className="h-3.5 w-3.5" />
        </Action>
      )}
      </div></details>}
      {copyError && <p role="status" className="basis-full text-xs text-muted-foreground">{copyError}</p>}
    </div>
  );
}

function Action({
  label,
  onClick,
  children,
  disabled,
  alwaysVisible,
  className = '',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  alwaysVisible?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={event => {onClick(); const details = event.currentTarget.closest('details'); if (details) details.open = false;}}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-1.5 text-muted-foreground md:min-h-0 md:min-w-0 transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:text-foreground disabled:opacity-30 ${
        alwaysVisible ? 'opacity-100' : 'opacity-80 hover:opacity-100 focus-visible:opacity-100'
      } ${className}`}
    >
      {children}
    </button>
  );
}
