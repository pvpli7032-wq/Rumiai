import type {Metadata} from 'next';
import {AdminProviders} from './providers';
import '@rumiai/ui/styles.css';
import './admin.css';

export const metadata: Metadata = {title: {default: '星伴管理中心', template: '%s · 星伴管理中心'}, robots: {index: false, follow: false, nocache: true}};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="zh-CN" className="admin-theme" suppressHydrationWarning><body className="font-sans antialiased"><AdminProviders>{children}</AdminProviders></body></html>;
}
