export type StoryMessage = Readonly<{
  id: string;
  role: string;
  content: string;
  createdAt: string | Date;
}>;

export type ChapterCloseData = Readonly<{
  excerpts: readonly StoryMessage[];
  hasExcerpts: boolean;
}>;

const MAX_EXCERPT_LENGTH = 280;

/** Selects saved message excerpts only; it never summarizes or marks a chapter complete. */
export function buildChapterCloseData(
  messages: readonly StoryMessage[],
  maxExcerpts = 3,
): ChapterCloseData {
  const limit = Math.max(0, Math.min(3, Math.floor(maxExcerpts)));
  // slice(-0) returns the whole array, so an explicit zero has to short-circuit.
  if (limit === 0) return {excerpts: [], hasExcerpts: false};
  const excerpts = messages
    .filter(message => Boolean(message.content.trim()))
    .slice(-limit)
    .map(message => ({
      ...message,
      content: message.content.trim().length > MAX_EXCERPT_LENGTH
        ? message.content.trim().slice(0, MAX_EXCERPT_LENGTH) + '…'
        : message.content.trim(),
    }));
  return {excerpts, hasExcerpts: excerpts.length > 0};
}
