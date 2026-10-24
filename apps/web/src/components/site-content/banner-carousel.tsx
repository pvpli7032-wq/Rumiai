'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type HeroBanner = {
  id: string;
  title: string;
  description: string;
  href: string;
  gradientFrom: string;
  gradientTo: string;
  imageUrl?: string | null;
};

/**
 * The splash carousel. Advances on a timer, and exposes the same controls the live
 * site does — previous / next plus one dot per banner — so keyboard and screen
 * reader users can reach every slide.
 */
export function BannerCarousel({
  banners,
  labels,
}: {
  banners: HeroBanner[];
  /** Plain strings only: a server component cannot hand a function across the boundary. */
  labels: { prev: string; next: string; dots: string[]; nav: string };
}) {
  const [index, setIndex] = useState(0);
  const count = banners.length;

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  useEffect(() => {
    if (count < 2) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % count), 6000);
    return () => clearInterval(timer);
  }, [count]);

  if (count === 0) return null;
  const active = banners[index];

  return (
    <section className="relative mx-auto w-full max-w-3xl px-4">
      <div className="relative overflow-hidden rounded-3xl">
        <Link
          href={active.href}
          className="block min-h-[9rem] p-6 transition-opacity"
          style={{ backgroundImage: `${active.imageUrl ? `url("${active.imageUrl}"), ` : ''}linear-gradient(135deg, ${active.gradientFrom}, ${active.gradientTo})`, backgroundSize: active.imageUrl ? 'cover' : undefined, backgroundPosition: 'center' }}
        >
          <h2 className="text-xl font-bold text-white">{active.title}</h2>
          <p className="mt-1 max-w-md text-sm text-white/85">{active.description}</p>
        </Link>

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label={labels.prev}
              onClick={() => go(index - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-2 text-white transition-colors hover:bg-black/50"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label={labels.next}
              onClick={() => go(index + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-2 text-white transition-colors hover:bg-black/50"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2" aria-label={labels.nav}>
          {banners.map((banner, i) => (
            <button
              key={banner.id}
              type="button"
              aria-label={labels.dots[i]}
              aria-current={i === index}
              onClick={() => go(i)}
              className={`h-2 rounded-full transition-all ${i === index ? 'w-6 bg-white' : 'w-2 bg-white/30'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
