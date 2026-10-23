import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';
import { createVariants } from './variants';

const badgeVariants = createVariants(
  {
    variant: {
      neutral: 'bg-muted text-muted-foreground',
      brand: 'bg-brand-soft text-brand',
      success: 'bg-emerald-500/15 text-emerald-500',
      warning: 'bg-amber-500/15 text-amber-500',
      danger: 'bg-destructive/15 text-destructive',
      outline: 'border border-border text-foreground',
    },
    size: {
      sm: 'px-1.5 py-0.5 text-[10px]',
      md: 'px-2 py-0.5 text-xs',
    },
  },
  { variant: 'neutral', size: 'md' },
);

export type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'outline';

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

export function Badge({ variant = 'neutral', size = 'md', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full font-medium', badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}
