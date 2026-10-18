/** 对话与消息。字段只列前端真正读到的，避免和 Prisma 行绑死。 */

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  /** 后端在消息列表里回填；流式新增的消息还没有。 */
  likedAt?: string | null;
};

export type ConversationSummary = {
  id: string;
  title?: string | null;
  character?: {name?: string | null; avatarUrl?: string | null} | null;
};
