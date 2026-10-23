'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isPrimaryNavActive, PRIMARY_NAV } from '@web/lib/navigation';

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className="mobile-primary-nav fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm desktop:hidden">
      <div className="mx-auto flex max-w-lg">
        {PRIMARY_NAV.map(({ href, icon: Icon, label }) => {
          const active = isPrimaryNavActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap px-0.5 text-[11px] ${active ? 'text-brand' : 'text-muted-foreground'}`}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
