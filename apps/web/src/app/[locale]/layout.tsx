import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HTML_LANG, LOCALES, SITE_URL, alternateLanguages, getDictionary, isLocale } from '@web/lib/i18n';

/** Pre-render every locale shell; the list is small and fixed. */
export function generateStaticParams() {
  return LOCALES.map(locale => ({ locale }));
}

export async function generateMetadata({ params: paramsPromise }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await paramsPromise;

  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  return {
    title: dict.siteTitle,
    description: dict.siteDescription,
    alternates: {
      canonical: `${SITE_URL}/${params.locale}`,
      languages: alternateLanguages('/'),
    },
    openGraph: {
      title: dict.siteTitle,
      description: dict.siteDescription,
      url: `${SITE_URL}/${params.locale}`,
      type: 'website',
      locale: HTML_LANG[params.locale],
    },
  };
}

export default async function LocaleLayout({
  children,
  params: paramsPromise,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const params = await paramsPromise;

  // An unknown segment must 404 rather than render an English page at a bogus URL.
  if (!isLocale(params.locale)) notFound();
  return <div className="min-h-[100svh] bg-background text-foreground">{children}</div>;
}
