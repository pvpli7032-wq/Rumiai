'use client';
import { useEffect, useState } from 'react';
import {DEFAULT_ACCENT_FROM, DEFAULT_ACCENT_TO, DEFAULT_BRAND_LOGO, DEFAULT_BRAND_NAME} from '@/lib/site-content/brand-defaults';

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
export interface SiteNavigationItem {id:string;placement:'HEADER'|'FOOTER';label:string;href:string;sortOrder:number}
export interface SiteBranding {id:string;brandName:string;logoUrl:string|null;accentFrom:string;accentTo:string;footerNote:string|null}
export type SitePageBlock=
  | {type:'PARAGRAPH';text:string}
  | {type:'HEADING';text:string;level:2|3}
  | {type:'LINK';text:string;href:string}
  | {type:'NOTICE';text:string;tone:'INFO'|'WARNING'}
  | {type:'BUTTON';text:string;href:string;variant:'PRIMARY'|'SECONDARY'}
  | {type:'CARD_GRID';heading:string;cards:Array<{title:string;description:string;href:string;actionLabel:string}>}
  | {type:'IMAGE';src:string;alt:string;caption:string}
  | {type:'LIST';ordered:boolean;items:string[]};
export interface SitePage {id:string;slug:string;kind:'PAGE'|'ANNOUNCEMENT';title:string;summary:string;blocks:SitePageBlock[];sortOrder:number;startsAt:string|null;endsAt:string|null}

export interface SiteContent {
  banners: { hero: SiteBanner[]; sidebar: SiteBanner[] };
  tags: SiteTag[];
  badges: SiteBadge[];
  sections: SiteSection[];
  navigation: {header: SiteNavigationItem[]; footer: SiteNavigationItem[]};
  branding: SiteBranding;
  announcements: SitePage[];
  nextScheduledAt: string | null;
}

const DEFAULT_BRANDING:SiteBranding={id:'primary',brandName:DEFAULT_BRAND_NAME,logoUrl:DEFAULT_BRAND_LOGO,accentFrom:DEFAULT_ACCENT_FROM,accentTo:DEFAULT_ACCENT_TO,footerNote:null};
const EMPTY: SiteContent = { banners: { hero: [], sidebar: [] }, tags: [], badges: [], sections: [], navigation:{header:[],footer:[]}, branding:DEFAULT_BRANDING, announcements:[], nextScheduledAt: null };

/** In-memory cache so the shell and the page don't each refetch on navigation. */
let cache: SiteContent | null = null;
let inflight: Promise<SiteContent> | null = null;
let cacheUpdatedAt = 0;

function load(refresh = false): Promise<SiteContent> {
  if (cache && (!refresh || Date.now() - cacheUpdatedAt < 30_000)) return Promise.resolve(cache);
  inflight ??= fetch('/api/site')
    .then((r) => (r.ok ? r.json() : EMPTY))
    .then((d: SiteContent) => {
      cache = d;
      cacheUpdatedAt = Date.now();
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
    const timer = window.setInterval(() => {
      load(true).then(d => {if (alive) setContent(d);});
    }, 30_000);
    const scheduled = cache?.nextScheduledAt ? Date.parse(cache.nextScheduledAt) : NaN;
    const timeout = Number.isFinite(scheduled) && scheduled > Date.now()
      ? window.setTimeout(() => {load(true).then(d => {if (alive) setContent(d);});}, Math.min(2_147_000_000, scheduled - Date.now() + 150))
      : null;
    return () => {
      alive = false;
      window.clearInterval(timer);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, []);

  return { ...content, loading };
}
