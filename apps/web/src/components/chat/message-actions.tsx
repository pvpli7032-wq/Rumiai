'use client';

import { Heart, RotateCcw, Pencil, Volume2, VolumeX, Copy, Check, Flag } from 'lucide-react';
import { useState } from 'react';
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
}) {
  const [copied, setCopied] = useState(false);
  const isReply = role !== 'USER';

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText(content));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; saying nothing is better than a scary error.
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {isReply && onLike && (
        <Action
          label={liked ? "取消消息点赞" : "点赞消息"}
          onClick={onLike}
          // A set like must not fade out with the rest, or its state is invisible.
          alwaysVisible={liked}
          className={liked ? 'text-pink-400' : ''}
        >
          <Heart className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} />
        </Action>
      )}

      <Action label={copied ? "已复制" : "复制消息"} onClick={copy} alwaysVisible={copied}>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </Action>

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
          <RotateCcw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        </Action>
      )}

      {isReply && onReport && <Action label="举报这条 AI 回复" onClick={onReport} disabled={disabled}><Flag className="h-3.5 w-3.5" /></Action>}

      {!isReply && onEdit && (
        <Action label={"编辑消息"} onClick={onEdit} disabled={disabled || busy}>
          <Pencil className="h-3.5 w-3.5" />
        </Action>
      )}
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
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-1.5 text-zinc-500 md:min-h-0 md:min-w-0 transition-all hover:text-zinc-200 disabled:opacity-30 ${
        alwaysVisible ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover/msg:opacity-100 focus-visible:opacity-100'
      } ${className}`}
    >
      {children}
    </button>
  );
}
