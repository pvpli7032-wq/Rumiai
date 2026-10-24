import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { DEFAULT_LOCALE, HTML_LANG, SITE_URL, getDictionary } from '@web/lib/i18n';
import '@rumiai/ui/styles.css';
import '../styles/index.css';

// theme-color follows the OS appearance; the --theme-color token in globals.css mirrors these values.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF9F6' },
    { media: '(prefers-color-scheme: dark)', color: '#0D0D12' },
  ],
  interactiveWidget: 'resizes-content',
};
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
      <body className="min-h-[100svh] bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
