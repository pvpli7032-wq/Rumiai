'use client';

import { useState } from 'react';
import { CharacterCard, type CharacterCardData } from '@/components/character-card';

const RANGES = ["今天", "本周", "本月", "全部"];

/** Horizontal scrolling rail of character cards with a time-range filter. */
export function CharacterRail({
  emoji,
  title,
  characters,
}: {
  emoji: string;
  title: string;
  characters: CharacterCardData[];
}) {
  const [range, setRange] = useState("本周");
  if (characters.length === 0) return null;

  return (
    <div className="space-y-4 px-4 md:px-12">
      <p className="inline-flex items-center gap-1.5 font-athiti text-base font-bold md:text-lg">
        <span aria-hidden className="shrink-0 select-none leading-none">{emoji}</span>
        <span className="min-w-0">{title}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => {
          const active = r === range;
          return (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`h-8 rounded-xl px-3 font-athiti text-sm transition-all duration-200 ${
                active
                  ? 'font-bold border border-zinc-200 dark:border-transparent dark:bg-zinc-800'
                  : 'font-medium text-neutral-500 hover:bg-accent'
              }`}
            >
              <span className={active ? 'bg-linear-to-r/srgb from-[#EE4036] to-[#FAAF40] bg-clip-text text-transparent' : ''}>
                {r}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {characters.map((c, i) => (
          <div key={`${c.id}-${i}`} className="w-[150px] shrink-0 md:w-[190px]">
            <CharacterCard character={c} index={i} />
          </div>
        ))}
      </div>
    </div>
  );
}
