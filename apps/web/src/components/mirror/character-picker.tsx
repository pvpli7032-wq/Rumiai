'use client';
import {cn} from '@rumiai/ui';
import type {MirrorCharacterOption} from '@rumiai/contracts/mirror/types';

/** 选角色：运营指定的角色名单由服务端给出，这里只负责渲染与选中。 */
export function MirrorCharacterPicker({characters, value, onChange, disabled}: {characters: MirrorCharacterOption[]; value: string | null; onChange: (id: string) => void; disabled?: boolean}) {
  if (!characters.length) return <p className="text-sm text-muted-foreground">暂时没有可用于这里的角色。</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 tablet:grid-cols-3">
      {characters.map(character => {
        const selected = character.id === value;
        return (
          <li key={character.id}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(character.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                selected ? 'border-brand bg-brand-soft' : 'border-border hover:bg-muted',
                'disabled:pointer-events-none disabled:opacity-60',
              )}
            >
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                {character.avatarUrl ? <img src={character.avatarUrl} alt="" className="h-full w-full object-cover" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{character.name}</span>
                {character.tagline && <span className="block truncate text-xs text-muted-foreground">{character.tagline}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
