import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';
import { createVariants } from './variants';

const inputSizes = createVariants(
  {
    size: {
      sm: 'h-8 px-2 text-xs',
      md: 'h-10 px-3 text-sm',
      lg: 'h-12 px-4 text-base',
    },
  },
  { size: 'md' },
);

/** `size` is the control size here, not the native character-width attribute. */
export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  /** Marks the field invalid for styling and assistive tech. */
  invalid?: boolean;
}

export function Input({ size = 'md', invalid = false, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-md border border-input bg-background text-foreground transition-colors',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-destructive focus-visible:ring-destructive',
        inputSizes({ size }),
        className,
      )}
      {...props}
    />
  );
}
