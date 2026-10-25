'use client';
import type {ReactNode} from 'react';
import {BackButton} from '@/components/layout/back-button';
import { DesignIcon } from '@/components/primitives/design-icon';
import { CharacterAvatar, type Character } from './character-avatar';

export function ChatHeader({character,streaming,actions}:{character:Character|null;streaming:boolean;actions?:ReactNode}) {
  return <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
    <BackButton fallback="/chat" ariaLabel="返回上一页" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-secondary"><DesignIcon name="ph:arrow-left" size={20} /></BackButton>
    {character && <><CharacterAvatar character={character} size={40} /><div className="min-w-0 flex-1"><h1 className="truncate text-[15px] font-semibold">{character.name}</h1><p role={streaming ? 'status' : undefined} className="mt-0.5 text-xs text-muted-foreground">{streaming ? '正在输入…' : 'AI角色'}</p></div>{actions}</>}
  </header>;
}
