'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n';

/**
 * Header for the public pages: logo, sign-in, language switcher. Mirrors the live
 * site, where the marketing pages carry no app navigation at all.
 */
export function PublicHeader({ locale, signInLabel }: { locale: Locale; signInLabel: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  /** Same page, different locale — keeps the visitor where they were. */
  function swapLocale(next: Locale) {
    const rest = pathname.replace(/^\/[^/]+/, '');
    return `/${next}${rest}`;
  }

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3 desktop:px-8">
      <Link href={`/${locale}`} className="flex items-center gap-2" aria-label="星伴">
        <img src="/brand/icon.svg" alt="" width={32} height={32} /><span className="text-xl font-bold">星伴</span>
      </Link>

      <div className="flex items-center gap-2">
        <Link
          href={`/${locale}/auth`}
          className="rounded-full border border-white/15 px-4 py-2 text-sm font-athiti text-white transition-colors hover:bg-white/5"
        >
          {signInLabel}
        </Link>

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-sm text-white transition-colors hover:bg-white/5"
          >
            <span aria-hidden>{LOCALE_LABELS[locale].flag}</span>
            <span className="font-barlow">{LOCALE_LABELS[locale].short}</span>
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-xl"
            >
              {LOCALES.map(l => (
                <Link
                  key={l}
                  role="menuitem"
                  href={swapLocale(l)}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-athiti transition-colors hover:bg-white/5 ${
                    l === locale ? 'text-white' : 'text-zinc-400'
                  }`}
                >
                  <span aria-hidden>{LOCALE_LABELS[l].flag}</span>
                  {LOCALE_LABELS[l].name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
