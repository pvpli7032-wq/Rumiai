const readAiInteger = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name];
  if (raw === undefined || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};

export const HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS) || 20;
export const CHAT_LIMIT = Number(process.env.CHAT_RATE_LIMIT) || 30;
export const CHAT_WINDOW_MS = Number(process.env.CHAT_RATE_WINDOW_MS) || 60_000;
export const CHAT_DAILY_LIMIT = readAiInteger('CHAT_DAILY_LIMIT', 200, 0, 1_000_000);

export { readAiInteger };
