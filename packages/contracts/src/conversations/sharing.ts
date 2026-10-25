export type ShareMessage = {id: string; role: string; content: string; createdAt: string; version: string};
export type ConversationSharePreview = {
  maxMessages: number; messages: ShareMessage[];
  shares: Array<{id: string; createdAt: string; messageCount: number}>;
};
export type CreateConversationShare = {confirmed: true; messageIds: string[]; messageVersions: Record<string,string>};
