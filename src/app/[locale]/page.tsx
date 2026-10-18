import Link from 'next/link';
import {getDictionary, isLocale, type Locale, DEFAULT_LOCALE} from '@/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {BannerCarousel,type HeroBanner} from '@/components/banner-carousel';
import {SignedInRedirect} from './signed-in-redirect';
import {readPublicSiteContent} from '@/lib/site-content/public-service';
import {PublicFooter} from '@/components/site-content/public-footer';

export const dynamic='force-dynamic';
export default async function LocaleHome({params}:{params:Promise<{locale:string}>}){
  const {locale:raw}=await params,locale=(isLocale(raw)?raw:DEFAULT_LOCALE) as Locale,dict=getDictionary(locale),site=await readPublicSiteContent(),banners=site.banners.hero as HeroBanner[];
  return <main className="flex min-h-[100svh] flex-col"><SignedInRedirect/><PublicHeader locale={locale} signInLabel={dict.signIn}/><div className="flex flex-1 flex-col items-center justify-center gap-8 py-12"><BannerCarousel banners={banners} labels={{prev:dict.prevBanner,next:dict.nextBanner,dots:banners.map((_,i)=>dict.goToBanner(i+1)),nav:dict.bannerNav}}/><div className="px-6 text-center"><h1 className="font-athithi text-2xl font-bold text-white desktop:text-4xl">{site.branding.brandName}</h1><p className="mx-auto mt-3 max-w-xl font-athithi text-zinc-400">{dict.siteDescription}</p></div><Link href={`/${locale}/auth`} className="rounded-full bg-linear-to-r/srgb from-purple-600 to-pink-600 px-10 py-3 font-athithi text-lg font-semibold text-white shadow-lg transition-transform hover:scale-105">{dict.chatNow}</Link><nav className="flex gap-5 font-athithi text-sm text-zinc-500"><Link href={`/${locale}/explore`} className="transition-colors hover:text-zinc-300">{dict.charactersSection}</Link><Link href={`/${locale}/about`} className="transition-colors hover:text-zinc-300">{dict.aboutHeading}</Link><Link href={`/${locale}/terms-and-policy`} className="transition-colors hover:text-zinc-300">{dict.termsHeading}</Link><Link href="/announcements" className="transition-colors hover:text-zinc-300">站点公告</Link></nav></div><PublicFooter/></main>;
}
