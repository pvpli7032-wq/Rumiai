'use client';
import {useEffect, useState} from 'react';
import {Monitor, Moon, Sun} from 'lucide-react';
import {useTheme} from 'next-themes';
import {cn} from './cn';

const OPTIONS = [{value: 'light', label: '浅色', Icon: Sun}, {value: 'dark', label: '深色', Icon: Moon}, {value: 'system', label: '跟随系统', Icon: Monitor}] as const;
export function ThemeToggle({className}: {className?: string}) {
  const {theme, setTheme} = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <div role="group" aria-label="主题" className={cn('flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5', className)}>{OPTIONS.map(({value, label, Icon}) => <button key={value} type="button" onClick={() => setTheme(value)} aria-pressed={mounted && theme === value} aria-label={label} title={label} className={cn('flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', mounted && theme === value && 'bg-accent text-foreground')}><Icon aria-hidden className="h-4 w-4" /></button>)}</div>;
}
