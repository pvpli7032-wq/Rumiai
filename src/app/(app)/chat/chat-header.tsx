'use client';

import Link from 'next/link';
import { ArrowLeft, Flag } from 'lucide-react';
import { CharacterAvatar, type Character } from './character-avatar';

/** 聊天顶栏：返回、角色头像与名称、输入中指示、举报入口。 */
export function ChatHeader({
  character,
  streaming,
  onReport,
}: {
  character: Character | null;
  streaming: boolean;
  onReport: () => void;
}) {
  return (
    <div className="bg-zinc-900/80 border-b border-white/10 backdrop-blur-xs px-4 py-3 flex items-center gap-3">
      <Link href="/discover" className="p-2 rounded-full hover:bg-white/5 transition-colors text-zinc-400 hover:text-white">
        <ArrowLeft className="w-5 h-5" />
      </Link>
      {character && (
        <>
          <CharacterAvatar character={character} size={40} />
          <div>
            <h2 className="font-semibold text-white">{character.name}</h2>
            <p className="text-xs text-zinc-400 truncate max-w-48">{character.personality.slice(0, 50)}</p>
          </div>
        </>
      )}
      {streaming && <div className="ml-auto flex items-center gap-2 text-xs text-purple-400"><div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />{"正在输入…"}</div>}
      {character && (
        <button
          onClick={onReport}
          aria-label={"举报角色"}
          title={"举报角色"}
          className={`${streaming ? '' : 'ml-auto '}rounded-full p-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-white`}
        >
          <Flag className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
