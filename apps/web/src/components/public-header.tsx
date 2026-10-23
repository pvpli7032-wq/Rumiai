'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LOCALES, LOCALE_LABELS, type Locale } from '@web/lib/i18n';
import {useSiteContent} from '@web/lib/use-site-content';

/**
 * Header for the public pages: logo, sign-in, language switcher. Mirrors the live
 * site, where the marketing pages carry no app navigation at all.
 */
export function PublicHeader({ locale, signInLabel }: { locale: Locale; signInLabel: string }) {
  const pathname = usePathname();
  const {navigation,branding}=useSiteContent();
  const [open, setOpen] = useState(false);

  /** Same page, different locale — keeps the visitor where they were. */
  function swapLocale(next: Locale) {
    const rest = pathname.replace(/^\/[^/]+/, '');
    return `/${next}${rest}`;
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 desktop:px-8">
      <Link href={`/${locale}`} className="order-1 flex shrink-0 items-center gap-2" aria-label={branding.brandName}>
        {branding.logoUrl&&<img src={branding.logoUrl} alt="" width={32} height={32} />}<span className="text-xl font-bold" style={{backgroundImage:`linear-gradient(90deg,${branding.accentFrom},${branding.accentTo})`,backgroundClip:'text',color:'transparent'}}>{branding.brandName}</span>
      </Link>

      <div className="order-2 flex min-w-0 items-center gap-2 desktop:order-3">
        <Link
          href={`/${locale}/auth`}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white transition-colors hover:bg-white/5"
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
            <span>{LOCALE_LABELS[locale].short}</span>
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
                  className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-white/5 ${
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
      {navigation.header.length>0&&<nav aria-label="站点导航" className="order-3 flex min-w-0 basis-full gap-3 overflow-x-auto text-sm desktop:order-2 desktop:basis-auto">{navigation.header.map(item=><Link key={item.id} href={item.href} className="min-h-11 shrink-0 inline-flex items-center text-zinc-300 hover:text-white">{item.label}</Link>)}</nav>}
    </header>
  );
}
