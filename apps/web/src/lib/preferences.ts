/**
 * Reader preferences stored on the user row.
 *
 * `shortcuts` is opaque JSON as far as the API is concerned — the server only checks that
 * it parses and is not oversized. This module owns the shape the client actually uses, so
 * a malformed or older value degrades to an empty list instead of throwing inside a render.
 */

export interface Shortcut {
  label: string;
  text: string;
}

export const MAX_SHORTCUTS = 12;
export const MAX_SHORTCUT_LABEL = 24;
export const MAX_SHORTCUT_TEXT = 300;

export function parseShortcuts(raw: string | null | undefined): Shortcut[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is Shortcut => Boolean(s) && typeof s.label === 'string' && typeof s.text === 'string')
      .slice(0, MAX_SHORTCUTS)
      .map((s) => ({
        label: s.label.slice(0, MAX_SHORTCUT_LABEL),
        text: s.text.slice(0, MAX_SHORTCUT_TEXT),
      }));
  } catch {
    return [];
  }
}

export function serialiseShortcuts(shortcuts: Shortcut[]): string {
  return JSON.stringify(
    shortcuts
      .filter((s) => s.label.trim() && s.text.trim())
      .slice(0, MAX_SHORTCUTS)
      .map((s) => ({
        label: s.label.trim().slice(0, MAX_SHORTCUT_LABEL),
        text: s.text.trim().slice(0, MAX_SHORTCUT_TEXT),
      }))
  );
}

/** The banned-word list is newline-separated so a single entry may contain a comma. */
export function parseBannedWords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Whether a reply trips the reader's own banned-word list. This is the reader's filter for
 * their own comfort, applied on display — it is not moderation, and it deliberately does
 * not delete or rewrite anything the character said.
 */
export function containsBannedWord(text: string, banned: string[]): boolean {
  if (banned.length === 0) return false;
  const haystack = text.toLowerCase();
  return banned.some((word) => haystack.includes(word.toLowerCase()));
}
