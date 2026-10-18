'use client';
import Link from 'next/link';
import {useSiteContent} from '@/lib/use-site-content';

export function PublicFooter() {
  const {branding,navigation}=useSiteContent();
  return <footer className="mt-auto border-t border-white/10 px-6 py-6 text-sm text-zinc-400"><div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3"><span>{branding.footerNote||branding.brandName}</span>{navigation.footer.length>0&&<nav aria-label="页脚导航" className="flex flex-wrap gap-x-4 gap-y-2">{navigation.footer.map(item=><Link key={item.id} href={item.href} className="min-h-11 inline-flex items-center hover:text-white">{item.label}</Link>)}</nav>}</div></footer>;
}
