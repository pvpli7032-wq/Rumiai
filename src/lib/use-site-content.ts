'use client';
import { useEffect, useState } from 'react';

export interface SiteBanner {
  id: string;
  title: string;
  description: string;
  href: string;
  gradientFrom: string;
  gradientTo: string;
  imageUrl: string | null;
}

export interface SiteTag {
  key: string;
  label: string;
  group: string;
  filterRow: string | null;
}

export interface SiteBadge {
  emoji: string;
  label: string;
}

export interface SiteSection {
  key: string;
  emoji: string;
  title: string;
  /** FOR_YOU | EXCLUSIVE | POPULAR | NEWEST | TAG */
  source: string;
  tagKey: string | null;
}

export interface SiteContent {
  banners: { hero: SiteBanner[]; sidebar: SiteBanner[] };
  tags: SiteTag[];
  badges: SiteBadge[];
  sections: SiteSection[];
}

const EMPTY: SiteContent = { banners: { hero: [], sidebar: [] }, tags: [], badges: [], sections: [] };

/** In-memory cache so the shell and the page don't each refetch on navigation. */
let cache: SiteContent | null = null;
let inflight: Promise<SiteContent> | null = null;

function load(): Promise<SiteContent> {
  if (cache) return Promise.resolve(cache);
  inflight ??= fetch('/api/site')
    .then((r) => (r.ok ? r.json() : EMPTY))
    .then((d: SiteContent) => {
      cache = d;
      inflight = null;
      return d;
    })
    .catch(() => {
      inflight = null;
      return EMPTY;
    });
  return inflight;
}

/** Banners, tags, badges and rail configuration — all served from the database. */
export function useSiteContent() {
  const [content, setContent] = useState<SiteContent>(cache ?? EMPTY);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    load().then((d) => {
      if (!alive) return;
      setContent(d);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { ...content, loading };
}
