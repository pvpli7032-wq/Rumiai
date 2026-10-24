'use client';

import { useState } from 'react';
import { EyeOff } from 'lucide-react';

/**
 * A reply that matched the reader's own banned-word list.
 *
 * Hidden behind a tap rather than removed or rewritten: the list is the reader's comfort
 * filter, not moderation, and silently dropping part of a conversation would leave the
 * thread reading as though the character never answered.
 */
export function HiddenReply({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);

  if (shown) return <>{children}</>;

  return (
    <button
      onClick={() => setShown(true)}
      className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-left text-xs text-muted-foreground hover:border-zinc-500 hover:text-foreground"
    >
      <EyeOff className="h-3.5 w-3.5 shrink-0" />
      {"这条回复含有你屏蔽的词语，点击查看"}</button>
  );
}
