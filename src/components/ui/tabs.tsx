'use client';

import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from './cn';

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`<${component}> must be rendered inside <Tabs>`);
  return context;
}

export interface TabsProps {
  /** Controlled active tab. */
  value?: string;
  /** Uncontrolled initial tab. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, defaultValue = '', onValueChange, children, className }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const baseId = useId();
  const active = value ?? internalValue;

  const context = useMemo<TabsContextValue>(
    () => ({
      value: active,
      setValue: (next: string) => {
        if (value === undefined) setInternalValue(next);
        onValueChange?.(next);
      },
      baseId,
    }),
    [active, value, onValueChange, baseId],
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={cn('flex flex-col gap-3', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function TabsList({ children, className, ...props }: TabsListProps) {
  return (
    <div role="tablist" className={cn('inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1', className)} {...props}>
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function TabsTrigger({ value, children, className, disabled }: TabsTriggerProps) {
  const { value: active, setValue, baseId } = useTabsContext('TabsTrigger');
  const selected = active === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        'inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: active, baseId } = useTabsContext('TabsContent');
  if (active !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={cn('focus-visible:outline-none', className)}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
