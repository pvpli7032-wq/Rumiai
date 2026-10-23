'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { compactNumber } from '@web/lib/i18n';

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-0 tablet:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto bg-zinc-900 tablet:max-h-[92vh] tablet:rounded-3xl tablet:border tablet:border-white/10"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

export function GalleryArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? "上一张图片" : "下一张图片"}
      className={`absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 ${
        side === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

export function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1" title={label}>
      {icon}
      {compactNumber(value)}
    </span>
  );
}

export function IconAction({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-xs font-bold transition-colors ${
        active
          ? 'border-brand-strong/50 bg-brand-strong/10 text-brand-strong'
          : 'border-white/10 text-zinc-300 hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3 pb-2 text-sm font-bold transition-colors ${
        active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-white" />}
    </button>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-zinc-500">{title}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{children}</p>
    </div>
  );
}
