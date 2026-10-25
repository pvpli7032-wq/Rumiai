'use client';
import type {ReactNode} from 'react';
import {DesignIcon} from '@/components/primitives/design-icon';
import {useAppBack} from './navigation-history';
export function BackButton({fallback,children,className='',ariaLabel='返回上一页'}:{fallback?:string;children?:ReactNode;className?:string;ariaLabel?:string}){
  const back=useAppBack(fallback);
  return <button type="button" onClick={back} aria-label={ariaLabel} className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full text-foreground hover:bg-secondary ${className}`}>{children??<><DesignIcon name="ph:arrow-left" size={20}/><span className="text-sm">返回</span></>}</button>;
}
