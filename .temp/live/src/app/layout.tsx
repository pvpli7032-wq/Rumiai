import type { Metadata, Viewport } from 'next';
import { PwaController } from '@/components/pwa-controller';
import { Providers } from './providers';
import { DEFAULT_LOCALE, HTML_LANG, SITE_URL, getDictionary } from '@/lib/i18n';
import './globals.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#09090b', interactiveWidget: 'resizes-content' };
const dict = getDictionary(DEFAULT_LOCALE);

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: dict.siteTitle,
  description: '星伴：发现原创角色，开启中文 AI 对话',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/brand/icon-192.png', apple: '/brand/icon-192.png' },
};

/**
 * Only the document shell lives here. The signed-in chrome moved to
 * (app)/layout.tsx so that the public /[locale] pages can render standalone, the
 * way they do on the live site.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={HTML_LANG[DEFAULT_LOCALE]} suppressHydrationWarning>
<body className="font-sans antialiased">
        <Providers>{children}<PwaController /></Providers>
      </body>
    </html>
  );
}
