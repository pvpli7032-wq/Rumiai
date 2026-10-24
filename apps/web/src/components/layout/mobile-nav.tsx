'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isPrimaryNavActive, PRIMARY_NAV } from '@web/lib/navigation';
import { DesignIcon, type DesignIconName } from '@/components/primitives/design-icon';

const icons: Record<string, [DesignIconName, DesignIconName]> = {
  '/discover': ['ph:compass', 'ph:compass-fill'],
  '/chat': ['ph:chat-circle', 'ph:chat-circle-fill'],
  '/creator': ['ph:plus-circle', 'ph:plus-circle-fill'],
  '/square': ['ph:planet', 'ph:planet-fill'],
  '/profile': ['ph:user-circle', 'ph:user-circle-fill'],
};

export function MobileNav() {
  const pathname = usePathname();
  return <nav aria-label="主导航" className="mobile-primary-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm desktop:hidden">
    <div className="mx-auto flex max-w-lg">
      {PRIMARY_NAV.map(({ href, label }) => {
        const active = isPrimaryNavActive(pathname, href);
        return <Link key={href} href={href} scroll={false} aria-current={active ? 'page' : undefined}
          className={`flex min-h-[64px] min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap px-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
          <DesignIcon name={icons[href][active ? 1 : 0]} size={24} />
          <span className="truncate">{label}</span>
        </Link>;
      })}
    </div>
  </nav>;
}
