'use client';
import { DesignIcon } from '@/components/primitives/design-icon';

export function FilterRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 whitespace-nowrap text-sm font-bold text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((o) => {
          const active = selected.includes(o.key);
          return (
            <button
              key={o.key}
              onClick={() => onToggle(o.key)}
              className={`flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-semibold transition-all ${
                active ? 'bg-brand-gradient text-white' : 'border border-border text-foreground dark:border-border'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SearchRow({
  query,
  onQueryChange,
  onRandom,
  onSearch,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onRandom: () => void;
  onSearch: () => void;
}) {
  return <form role="search" onSubmit={event => { event.preventDefault(); onSearch(); }} className="flex w-full items-center gap-2">
    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-card px-4"><DesignIcon name="ph:magnifying-glass" className="h-5 w-5 shrink-0 text-muted-foreground"/><input type="search" enterKeyHint="search" aria-label="搜索角色" placeholder="搜索角色" value={query} onChange={event => onQueryChange(event.target.value)} className="min-w-0 w-full bg-transparent py-2.5 text-sm outline-none"/></label>
    <button type="button" aria-label="随机探索角色" onClick={onRandom} className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-card text-primary active:bg-muted"><DesignIcon name="ph:arrows-clockwise"/></button>
  </form>;
}
