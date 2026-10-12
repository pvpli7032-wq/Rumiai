/**
 * The roleplay markup the characters actually write in.
 *
 * Two forms carry almost all of it and are in the seeded data today — 223 greetings and
 * 80 messages use them:
 *
 *   *เขายืนพิงกำแพง*   narration / stage direction
 *   "กลับดึกจังนะ"      spoken dialogue
 *
 * The chat rendered raw text, so readers saw the asterisks. Three more forms come from
 * the live site's own richer markup:
 *
 *   /grad{ข้อความ}/       gradient-highlighted text
 *   /underline{ข้อความ}/  underlined text
 *   [💭 ความในใจ]         an inner thought, collapsed behind a toggle
 *
 * Parsing is deliberately non-destructive: anything that does not match falls through as
 * plain text, and an unclosed marker stays literal rather than swallowing the rest of the
 * message. A model mid-stream constantly produces half-written markup, so a parser that
 * consumed to end-of-string on an unclosed `*` would make the text jump around as it
 * arrives.
 */

export type Node =
  | { type: 'text'; value: string }
  | { type: 'narration'; value: string }
  | { type: 'speech'; value: string }
  | { type: 'gradient'; value: string }
  | { type: 'underline'; value: string }
  | { type: 'thought'; value: string };

interface Rule {
  open: string;
  close: string;
  type: Node['type'];
  /** Trim a leading marker kept inside the delimiters, e.g. the 💭 in `[💭 ...]`. */
  strip?: RegExp;
}

const RULES: Rule[] = [
  { open: '/grad{', close: '}/', type: 'gradient' },
  { open: '/underline{', close: '}/', type: 'underline' },
  { open: '[💭', close: ']', type: 'thought', strip: /^💭\s*/ },
  { open: '*', close: '*', type: 'narration' },
  { open: '"', close: '"', type: 'speech' },
];

export function parseRoleplay(input: string): Node[] {
  const nodes: Node[] = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain) {
      nodes.push({ type: 'text', value: plain });
      plain = '';
    }
  };

  outer: while (i < input.length) {
    for (const rule of RULES) {
      if (!input.startsWith(rule.open, i)) continue;

      const from = i + rule.open.length;
      const end = input.indexOf(rule.close, from);
      // Unclosed: leave the marker as literal text and move past it, so streaming text
      // does not reflow as the closing marker arrives.
      if (end === -1) continue;

      let value = input.slice(from, end);
      if (rule.strip) value = value.replace(rule.strip, '');
      value = value.trim();

      // An empty pair like `**` or `""` is punctuation, not markup.
      if (!value) continue;

      flush();
      nodes.push({ type: rule.type, value } as Node);
      i = end + rule.close.length;
      continue outer;
    }

    plain += input[i];
    i += 1;
  }

  flush();
  return nodes;
}

/** The message with all markup removed — for titles, previews and speech synthesis. */
export function plainText(input: string): string {
  return parseRoleplay(input)
    .map((n) => n.value)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a screen reader or TTS voice should say: narration and speech, not inner thoughts. */
export function spokenText(input: string): string {
  return parseRoleplay(input)
    .filter((n) => n.type !== 'thought')
    .map((n) => n.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
