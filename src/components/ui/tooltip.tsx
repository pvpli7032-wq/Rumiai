'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

const sides = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
};

export interface TooltipProps {
  content: ReactNode;
  side?: keyof typeof sides;
  /** Hover delay in ms before showing. Defaults to 150. */
  delay?: number;
  children: ReactNode;
  className?: string;
}

/** Hover/focus hint attached to a single child element. */
export function Tooltip({ content, side = 'top', delay = 150, children, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute z-50 w-max max-w-[16rem] rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md',
            sides[side],
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
