'use client';

import { useState } from 'react';

export interface Character { id: string; name: string; personality: string; background: string; greeting?: string | null; avatarUrl?: string | null; }

const EMOJI_LIST = ['🌸', '⚡', '🔮', '🌙', '✨', '💫', '🦋', '🌺', '🐉', '🦊'];

/**
 * Fallback badge for the handful of characters with no picture. Derived from the id
 * so a character keeps the same emoji — an incrementing counter used to hand out
 * whichever emoji came next, so it changed with load order.
 */
function getCharEmoji(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 1000003;
  return EMOJI_LIST[hash % EMOJI_LIST.length];
}

/**
 * The character's picture, matching what the discover cards show. This page used to
 * render only the emoji badge and never touched avatarUrl, so every character
 * appeared as an anonymous gradient circle once you opened the chat.
 */
export function CharacterAvatar({
  character,
  size,
  className = '',
}: {
  character: Pick<Character, 'id' | 'name' | 'avatarUrl'>;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (character.avatarUrl && !failed) {
    return (
      <img
        src={character.avatarUrl}
        alt={character.name}
        style={box}
        draggable={false}
        onError={() => setFailed(true)}
        className={`rounded-full object-cover bg-zinc-800 shadow-lg shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      style={{ ...box, fontSize: Math.round(size * 0.5) }}
      className={`rounded-full bg-linear-to-br/srgb from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shrink-0 ${className}`}
    >
      {getCharEmoji(character.id)}
    </div>
  );
}
