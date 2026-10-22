'use client';

import type { RefObject } from 'react';
import { CharacterAvatar, type Character } from './character-avatar';
import { RoleplayText } from '@/components/chat/roleplay-text';
import { MessageActions } from '@/components/chat/message-actions';
import { HiddenReply } from '@/components/chat/hidden-reply';
import { ScrollToLatest, type ChatScroll } from '@/components/chat/chat-interaction';
import { containsBannedWord } from '@/lib/preferences';
import type { ChatMessage as Message } from '@/lib/api-types/conversations';

/** 消息流：更早一页、空态开场、每条消息、流式气泡、回到最新。 */
export function ChatMessageList({
  messages, character, activeScene, readingMode, bannedWords, likedIds, speakingId, busyId,
  editingId, editDraft, streaming, streamingText, hasEarlier, loadingEarlier,
  chatScroll, messageListRef, messagesEndRef,
  onLoadEarlier, onToggleLike, onSpeak, onRegenerate, onSaveEdit, onReportMessage,
  setEditingId, setEditDraft,
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
  setEditingId: (id: string | null) => void;
  setEditDraft: (value: string) => void;
}) {
  return (
    <div ref={messageListRef} {...chatScroll.listProps} className={`flex-1 overflow-y-auto px-4 py-6 w-full mx-auto ${readingMode ? 'max-w-2xl space-y-6 text-[15px] leading-loose' : 'max-w-3xl space-y-4'}`}>
      {hasEarlier && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={onLoadEarlier}
            disabled={loadingEarlier}
            className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60"
          >
            {loadingEarlier ? '正在加载…' : '加载更早的消息'}
          </button>
        </div>
      )}
      {messages.length === 0 && character && (
        <div className="text-center py-8">
          <CharacterAvatar character={character} size={64} className="mx-auto mb-3" />
          <p className="text-zinc-300 text-lg font-semibold mb-1">{character.name}</p>
          <p className="text-zinc-400 text-sm">
            {activeScene ? <RoleplayText text={activeScene.opening ?? activeScene.hook} /> : character.greeting
              ? <RoleplayText text={character.greeting} />
              : "你好！我是" + (character.name) + "，很高兴认识你。"}
          </p>
        </div>
      )}
      {messages.map(msg => (
        <div key={msg.id} className={`flex ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}>
          {msg.role !== 'USER' && character && (
            <CharacterAvatar character={character} size={32} className="mr-2 mt-1" />
          )}
          <div className={`group/msg flex min-w-0 max-w-full flex-col gap-1 md:flex-row md:items-end ${msg.role === 'USER' ? 'items-end' : 'items-start'}`}>
            {editingId === msg.id ? (
              <div className="w-full max-w-md rounded-2xl bg-zinc-800 p-3">
                <textarea
                  value={editDraft}
                  onChange={e => setEditDraft(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-purple-500/50 focus:outline-hidden"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  {"编辑后将重新生成回复"}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setEditingId(null)}
                    className="flex-1 rounded-full border border-white/10 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
                  >
                    {"取消"}</button>
                  <button
                    onClick={() => onSaveEdit(msg.id)}
                    disabled={!editDraft.trim() || busyId === msg.id}
                    className="flex-1 rounded-full bg-purple-600 py-1.5 text-xs font-bold text-white hover:bg-purple-500 disabled:opacity-40"
                  >
                    {busyId === msg.id ? "正在保存…" : "保存并重新生成"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={`max-w-xs break-words md:max-w-md lg:max-w-lg rounded-2xl px-4 py-3 ${
                  msg.role === 'USER'
                    ? 'bg-linear-to-br/srgb from-purple-600 to-pink-600 text-white rounded-br-sm'
                    : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
                }`}>
                  {msg.role === 'USER' ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  ) : containsBannedWord(msg.content, bannedWords) ? (
                    <HiddenReply>
                      <RoleplayText text={msg.content} />
                    </HiddenReply>
                  ) : (
                    <RoleplayText text={msg.content} />
                  )}
                </div>
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
                  onReport={msg.role==='ASSISTANT'?()=>onReportMessage(msg.id):undefined}
                />
              </>
            )}
          </div>
        </div>
      ))}
      {streaming && streamingText && (
        <div className="flex justify-start">
          {character && <CharacterAvatar character={character} size={32} className="mr-2 mt-1" />}
          <div className="max-w-xs md:max-w-md lg:max-w-lg bg-zinc-800 rounded-2xl rounded-bl-sm px-4 py-3">
            <RoleplayText text={streamingText} streaming />
          </div>
        </div>
      )}
      {!chatScroll.atBottom && <ScrollToLatest onJump={chatScroll.jumpToLatest} />}
      <div ref={messagesEndRef} />
    </div>
  );
}
