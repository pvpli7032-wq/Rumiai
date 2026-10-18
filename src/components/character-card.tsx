'use client';
import { useState } from 'react';
import { Tag } from 'lucide-react';
import { CharacterDetailDialog } from './character-detail-dialog';

export interface CharacterCardData {
  id: string;
  name: string;
  tagline?: string | null;
  personality: string;
  avatarUrl?: string | null;
  chatCount: number;
  isExclusive?: boolean;
  /** Comma-separated emojis, e.g. "☺️,🎹" */
  badges?: string | null;
  tags?: string | null;
}

const GRADIENTS = [
  'from-[#3b1d4d] to-[#141428]',
  'from-[#1d3b4d] to-[#101a28]',
  'from-[#4d3b1d] to-[#281f10]',
  'from-[#1d4d33] to-[#10281c]',
  'from-[#4d1d2e] to-[#28101a]',
  'from-[#2a1d4d] to-[#151028]',
];

function formatCount(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** The "Only on Khui AI" pill shown on exclusive characters. */
function ExclusiveBadge() {
  return (
    <span className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-[#1A1A1A]/90 py-0.5 pl-2 pr-1 text-[9px] font-semibold text-white ring-1 ring-[#2A2A2A]">
      <span>Only on</span>
      <span className="text-[#F2572B]">Khui AI</span>
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-linear-to-br/srgb from-[#FFA202] to-[#FF1300] text-[7px] font-bold">
        K
      </span>
    </span>
  );
}

/** Poster-style character card (aspect 160/213) used in rails and grids. */
export function CharacterCard({
  character,
  index = 0,
}: {
  character: CharacterCardData;
  index?: number;
}) {
  const gradient = GRADIENTS[index % GRADIENTS.length];
  const badges = (character.badges ?? '').split(',').filter(Boolean);
  // Tapping a card opens the detail view, the way the live site does; it used to link
  // straight into /chat, which skipped the gallery, quests, like and report entirely.
  const [open, setOpen] = useState(false);

  return (
    <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      className="group flex w-full cursor-pointer flex-col text-left transition-all duration-150 ease-out active:scale-[0.98]"
    >
      <div className="relative aspect-[160/213] w-full overflow-hidden rounded-2xl bg-[#1A1A2E]">
        {character.avatarUrl ? (
          <img
            src={character.avatarUrl}
            alt={character.name}
            draggable={false}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className={`absolute inset-0 bg-linear-to-br/srgb ${gradient}`} />
        )}
        <div className="absolute inset-0 bg-linear-to-t/srgb from-black/60 via-transparent to-black/20" />

        {character.isExclusive && <ExclusiveBadge />}

        <span
          aria-hidden="true"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50"
        >
          <Tag className="h-3 w-3 text-white" />
        </span>

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5">
          <div className="flex gap-1">
            {badges.map((b) => (
              <span key={b} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-xs">
                {b}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5">
            <span className="text-[10px]">💬</span>
            <span className="text-[10px] font-semibold text-white">
              {formatCount(character.chatCount)}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-2 line-clamp-1 text-sm font-bold md:text-base">{character.name}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-gray-600 dark:text-slate-200 md:text-sm">
        {character.tagline || character.personality}
      </p>
    </button>
    {open && <CharacterDetailDialog characterId={character.id} onClose={() => setOpen(false)} />}
    </>
  );
}
