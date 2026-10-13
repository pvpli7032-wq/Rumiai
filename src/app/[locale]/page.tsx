import Link from 'next/link';
import { db } from '@/lib/db';
import { getDictionary, isLocale, type Locale } from '@/lib/i18n';
import { PublicHeader } from '@/components/public-header';
import { BannerCarousel, type HeroBanner } from '@/components/banner-carousel';
import { SignedInRedirect } from './signed-in-redirect';

/**
 * The public splash. On the live site everything sits behind sign-in, so this page
 * shows the banner carousel and a single call to action; visitors who already have
 * a session are sent straight into the app.
 */
export default async function LocaleHome({ params: paramsPromise }: { params: Promise<{ locale: string }> }) {
  const params = await paramsPromise;

  const locale = (isLocale(params.locale) ? params.locale : 'th') as Locale;
  const dict = getDictionary(locale);

  const banners = (await db.banner.findMany({
    where: { placement: 'HERO', isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, title: true, description: true, href: true, gradientFrom: true, gradientTo: true, imageUrl: true },
  })) as HeroBanner[];

  return (
    <main className="flex min-h-[100svh] flex-col">
      <SignedInRedirect />
      <PublicHeader locale={locale} signInLabel={dict.signIn} />

      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-12">
        <BannerCarousel
          banners={banners}
          labels={{
            prev: dict.prevBanner,
            next: dict.nextBanner,
            dots: banners.map((_, i) => dict.goToBanner(i + 1)),
            nav: dict.bannerNav,
          }}
        />

        <div className="px-6 text-center">
          <h1 className="font-athiti text-2xl font-bold text-white desktop:text-4xl">{dict.siteTitle.split('|')[0].trim()}</h1>
          <p className="mx-auto mt-3 max-w-xl font-athiti text-zinc-400">{dict.siteDescription}</p>
        </div>

        <Link
          href={`/${locale}/auth`}
          className="rounded-full bg-linear-to-r/srgb from-purple-600 to-pink-600 px-10 py-3 font-athiti text-lg font-semibold text-white shadow-lg transition-transform hover:scale-105"
        >
          {dict.chatNow}
        </Link>

        <nav className="flex gap-5 font-athiti text-sm text-zinc-500">
          <Link href={`/${locale}/explore`} className="transition-colors hover:text-zinc-300">
            {dict.charactersSection}
          </Link>
          <Link href={`/${locale}/about`} className="transition-colors hover:text-zinc-300">
            {dict.aboutHeading}
          </Link>
          <Link href={`/${locale}/terms-and-policy`} className="transition-colors hover:text-zinc-300">
            {dict.termsHeading}
          </Link>
        </nav>
      </div>
    </main>
  );
}
