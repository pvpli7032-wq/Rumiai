import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';
import { createVariants } from './variants';

const selectSizes = createVariants(
  {
    size: {
      sm: 'h-8 pl-2 pr-8 text-xs',
      md: 'h-10 pl-3 pr-9 text-sm',
      lg: 'h-12 pl-4 pr-10 text-base',
    },
  },
  { size: 'md' },
);

/** `size` is the control size here, not the native row-count attribute. */
export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
}

/** Native select with a styled trigger. Pass <option> children. */
export function Select({ size = 'md', invalid = false, className, children, ...props }: SelectProps) {
  return (
    <span className="relative inline-flex w-full">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full appearance-none rounded-md border border-input bg-background text-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          invalid && 'border-destructive focus-visible:ring-destructive',
          selectSizes({ size }),
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
