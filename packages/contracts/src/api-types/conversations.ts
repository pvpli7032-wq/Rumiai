/** 对话与消息。字段只列前端真正读到的，避免和 Prisma 行绑死。 */

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  /** 后端在消息列表里回填；流式新增的消息还没有。 */
  likedAt?: string | null;
  contextIncluded?: boolean;
  selectedVersionId?: string | null;
  attachments?: ChatMessageAttachment[];
};

export type ChatMessageAttachment =
  | {id: string; type: 'IMAGE'; url: string; mimeType: string; byteSize: number}
  | {id: string; type: 'AUDIO'; url: string; mimeType: string; byteSize: number; durationMs: number}
  | {id: string; type: 'STICKER'; stickerId: string; label?: string; glyph?: string};

export const CHAT_STICKERS = [
  {id: 'wave', glyph: '👋', label: '挥手'},
  {id: 'heart', glyph: '🥰', label: '喜欢'},
  {id: 'laugh', glyph: '🤣', label: '大笑'},
  {id: 'cheer', glyph: '🎉', label: '庆祝'},
  {id: 'hug', glyph: '🤗', label: '抱抱'},
  {id: 'sad', glyph: '🥺', label: '难过'},
] as const;

export type ConversationSummary = {
  id: string;
  title?: string | null;
  character?: {name?: string | null; avatarUrl?: string | null} | null;
};
