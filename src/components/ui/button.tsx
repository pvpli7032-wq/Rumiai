import { Loader2 } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from './cn';
import { createVariants } from './variants';

const buttonVariants = createVariants(
  {
    variant: {
      primary: 'bg-brand text-brand-foreground hover:opacity-90 active:opacity-100',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
      ghost: 'bg-transparent text-foreground hover:bg-muted',
      danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
      success: 'bg-emerald-600 text-white hover:opacity-90',
      link: 'bg-transparent text-brand underline-offset-4 hover:underline',
    },
    size: {
      sm: 'h-8 gap-1.5 px-3 text-xs',
      md: 'h-10 gap-2 px-4 text-sm',
      lg: 'h-12 gap-2 px-6 text-base',
      icon: 'h-10 w-10 justify-center',
    },
  },
  { variant: 'primary', size: 'md' },
);

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. */
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/** Presentational button. Callers own every behaviour behind onClick. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        buttonVariants({ variant, size }),
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}
