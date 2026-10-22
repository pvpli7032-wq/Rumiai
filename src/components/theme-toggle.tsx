'use client';

import {useEffect, useState} from 'react';
import {Monitor, Moon, Sun} from 'lucide-react';
import {useTheme} from 'next-themes';
import {cn} from '@/components/ui/cn';

/**
 * 主题切换：浅色 / 深色 / 跟随系统。
 *
 * 偏好由 next-themes 自己写进 localStorage（key: theme），刷新和跨页都保持，这里不再另存。
 * 服务端拿不到用户偏好，所以挂载前一律不标记选中态，避免 hydration 前后 aria-pressed 不一致。
 */
const OPTIONS = [
  {value: 'light', label: '浅色', Icon: Sun},
  {value: 'dark', label: '深色', Icon: Moon},
  {value: 'system', label: '跟随系统', Icon: Monitor},
] as const;

export function ThemeToggle({className}: {className?: string}) {
  const {theme, setTheme} = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div
      role="group"
      aria-label="主题"
      className={cn('flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5', className)}
    >
      {OPTIONS.map(({value, label, Icon}) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            aria-label={label}
            title={label}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active && 'bg-accent text-foreground',
            )}
          >
            <Icon aria-hidden className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
