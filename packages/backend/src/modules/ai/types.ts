export interface AiStreamMetrics {
  model?: string;
  modelKey?: string;
  attempts?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}
