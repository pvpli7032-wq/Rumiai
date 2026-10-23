'use client';

import { useState } from 'react';
import { cn } from './cn';
import { createVariants } from './variants';

const avatarSizes = createVariants(
  {
    size: {
      xs: 'h-6 w-6 text-[10px]',
      sm: 'h-8 w-8 text-xs',
      md: 'h-10 w-10 text-sm',
      lg: 'h-14 w-14 text-base',
      xl: 'h-20 w-20 text-xl',
    },
  },
  { size: 'md' },
);

export interface AvatarProps {
  src?: string | null;
  /** Accessible name. Empty string marks the avatar as decorative. */
  alt?: string;
  /** Used for the initial shown when there is no image. */
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  shape?: 'circle' | 'rounded';
  className?: string;
}

/** Image avatar with an initial fallback for missing or broken sources. */
export function Avatar({ src, alt = '', name, size = 'md', shape = 'circle', className }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(src) && !broken;
  const initial = (name ?? alt).trim().slice(0, 1).toUpperCase();

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-muted font-semibold text-muted-foreground',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        avatarSizes({ size }),
        className,
      )}
    >
      {showImage ? (
        <img src={src ?? ''} alt={alt} className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span aria-hidden>{initial || '?'}</span>
      )}
    </span>
  );
}
