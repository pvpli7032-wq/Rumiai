'use client';

import {useEffect, useRef, useState, type RefObject} from 'react';
import { CharacterAvatar, type Character } from './character-avatar';
import { RoleplayText } from '@/components/chat/roleplay-text';
import { MessageActions } from '@/components/chat/message-actions';
import { HiddenReply } from '@/components/chat/hidden-reply';
import { ScrollToLatest, type ChatScroll } from '@/components/chat/chat-interaction';
import { containsBannedWord } from '@web/lib/preferences';
import { CHAT_STICKERS, type ChatMessage as Message } from '@rumiai/contracts/api-types/conversations';

/** 消息流：更早一页、空态开场、每条消息、流式气泡、回到最新。 */
export function ChatMessageList({
  messages, character, activeScene, readingMode, bannedWords, likedIds, speakingId, busyId,
  editingId, editDraft, streaming, streamingText, hasEarlier, loadingEarlier,
  chatScroll, messageListRef, messagesEndRef,
  onLoadEarlier, onToggleLike, onSpeak, onRegenerate, onSaveEdit, onReportMessage,
  setEditingId, setEditDraft, onDeleteMessage, chatMaxChars,
}: {
  messages: Message[];
  character: Character | null;
  activeScene?: { opening?: string | null; hook: string };
  readingMode: boolean;
  bannedWords: string[];
  likedIds: Set<string>;
  speakingId: string | null;
  busyId: string | null;
  editingId: string | null;
  editDraft: string;
  streaming: boolean;
  streamingText: string;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  chatScroll: ChatScroll;
  messageListRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onLoadEarlier: () => void;
  onToggleLike: (messageId: string) => void;
  onSpeak: (messageId: string, content: string) => void;
  onRegenerate: (messageId: string) => void;
  onSaveEdit: (messageId: string) => void;
  onReportMessage: (messageId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  chatMaxChars?: number;
  setEditingId: (id: string | null) => void;
  setEditDraft: (value: string) => void;
}) {
  const [hasNew, setHasNew] = useState(false);
  const lastSeen = useRef<string | null>(null);
  const latestId = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (chatScroll.atBottom) {lastSeen.current = latestId; setHasNew(false);}
    else if (latestId !== lastSeen.current || streamingText) setHasNew(true);
  }, [chatScroll.atBottom, latestId, streamingText]);
  return (
    <div ref={messageListRef} {...chatScroll.listProps} className={`min-h-0 flex-1 overflow-y-auto px-4 py-5 w-full mx-auto ${readingMode ? 'max-w-2xl space-y-6 text-[15px] leading-loose' : 'max-w-3xl space-y-4'}`}>
      {hasEarlier && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={onLoadEarlier}
            disabled={loadingEarlier}
            className="min-h-11 rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
          >
            {loadingEarlier ? '正在加载…' : '加载更早的消息'}
          </button>
        </div>
      )}
      {messages.length === 0 && character && (
        <div className="rounded-[20px] bg-secondary/60 px-5 py-7 text-center">
          <CharacterAvatar character={character} size={64} className="mx-auto mb-3" />
          <p className="text-foreground text-lg font-semibold mb-1">{character.name}</p>
          <p className="text-muted-foreground text-sm">
            {activeScene ? <RoleplayText text={activeScene.opening ?? activeScene.hook} /> : character.greeting
              ? <RoleplayText text={character.greeting} />
              : "你好！我是" + (character.name) + "，很高兴认识你。"}
          </p>
        </div>
      )}
      {messages.map((msg, index) => (
        <div key={msg.id} className="space-y-2">
        {msg.createdAt && (!messages[index - 1]?.createdAt || new Date(msg.createdAt).toLocaleDateString() !== new Date(messages[index - 1].createdAt!).toLocaleDateString()) && <p className="py-2 text-center text-xs text-muted-foreground"><time dateTime={msg.createdAt}>{new Date(msg.createdAt).toLocaleDateString('zh-CN', {year: 'numeric', month: 'long', day: 'numeric'})}</time></p>}
        <div className={`flex ${msg.role === 'USER' ? 'items-end justify-end' : 'items-end justify-start'}`}>
          {msg.role !== 'USER' && character && (
            <CharacterAvatar character={character} size={32} className="mb-1 mr-2" />
          )}
          <div className={`group/msg select-text flex min-w-0 max-w-[85%] flex-col gap-1 ${msg.role === 'USER' ? 'items-end' : 'items-start'}`}>
            {editingId === msg.id ? (
              <div className="w-full max-w-md rounded-[18px] border border-border bg-card p-3">
                <textarea
                  value={editDraft}
                  onChange={e => setEditDraft(e.target.value)}
                  rows={3}
                  maxLength={chatMaxChars}
                  aria-label="编辑消息内容"
                  autoFocus
                  className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-hidden"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {"编辑后会删除后续消息，并按当前模型重新生成回复。"}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setEditingId(null)}
                    className="min-h-11 flex-1 rounded-full border border-border py-1.5 text-xs text-foreground hover:bg-secondary"
                  >
                    {"取消"}</button>
                  <button
                    onClick={() => onSaveEdit(msg.id)}
                    disabled={!editDraft.trim() || busyId === msg.id}
                    className="min-h-11 flex-1 rounded-full bg-brand py-1.5 text-xs font-bold text-white hover:bg-brand/90 disabled:opacity-40"
                  >
                    {busyId === msg.id ? "正在保存…" : "保存并重新生成"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={`max-w-full break-words rounded-[18px] px-4 py-3 text-[15px] leading-6 ${
                  msg.role === 'USER'
                    ? 'bg-secondary text-foreground rounded-br-[6px]'
                    : 'border border-border bg-card text-foreground rounded-bl-[6px]'
                }`}>
                  {msg.attachments?.map(attachment => attachment.type === 'IMAGE'
                    ? <img key={attachment.id} src={attachment.url} alt="用户发送的图片" className="mb-2 max-h-72 w-auto max-w-full rounded-xl object-contain" />
                    : <span key={attachment.id} role="img" aria-label={CHAT_STICKERS.find(item => item.id === attachment.stickerId)?.label || '表情包'} className="block text-6xl">{CHAT_STICKERS.find(item => item.id === attachment.stickerId)?.glyph || '❔'}</span>)}
                  {msg.role === 'USER' ? (
                    msg.content ? <p className="whitespace-pre-wrap text-[15px] leading-6">{msg.content}</p> : null
                  ) : containsBannedWord(msg.content, bannedWords) ? (
                    <HiddenReply>
                      <RoleplayText text={msg.content} />
                    </HiddenReply>
                  ) : (
                    <RoleplayText text={msg.content} />
                  )}
                </div>
                {msg.createdAt && <time dateTime={msg.createdAt} className="px-1 text-[11px] text-muted-foreground">{new Date(msg.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>}
                {msg.role === 'USER' && <span role={(msg as Message & {clientState?: string}).clientState ? 'status' : undefined} className="px-1 text-[11px] text-muted-foreground">{(msg as Message & {clientState?: string}).clientState === 'SENDING' ? '正在发送…' : (msg as Message & {clientState?: string}).clientState === 'PENDING' ? '已接收，等待确认保存…' : '已保存'}</span>}
                <MessageActions
                  role={msg.role}
                  content={msg.content}
                  liked={likedIds.has(msg.id)}
                  speaking={speakingId === msg.id}
                  busy={busyId === msg.id}
                  disabled={streaming}
                  onLike={() => onToggleLike(msg.id)}
                  onRegenerate={() => onRegenerate(msg.id)}
                  onEdit={() => { setEditingId(msg.id); setEditDraft(msg.content); }}
                  onSpeak={() => onSpeak(msg.id, msg.content)}
                  onDelete={() => onDeleteMessage(msg.id)}
                  onReport={msg.role==='ASSISTANT'?()=>onReportMessage(msg.id):undefined}
                />
              </>
            )}
          </div>
        </div>
        </div>
      ))}
      {streaming && (
        <div className="flex justify-start">
          {character && <CharacterAvatar character={character} size={32} className="mb-1 mr-2" />}
          <div className="max-w-[85%] rounded-[18px] rounded-bl-[6px] border border-border bg-card px-4 py-3">
            {streamingText ? <RoleplayText text={streamingText} streaming /> : <span role="status" className="text-sm text-muted-foreground">正在输入…</span>}
          </div>
        </div>
      )}
      {!chatScroll.atBottom && <ScrollToLatest onJump={chatScroll.jumpToLatest} hasNew={hasNew} />}
      <div ref={messagesEndRef} />
    </div>
  );
}
