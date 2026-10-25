export interface ChatSuggestionCapability {available: boolean; reason: string | null; count: number; maxChars: number; remaining: number; resetAt: string}
export interface ChatSuggestionResult {requestId: string; suggestions: string[]; remaining: number}
