import type { Metadata } from 'next';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {AdminShell} from '@admin/components/admin-shell';
import {AdminAccessProvider} from '@admin/components/use-admin-access';

export const metadata: Metadata = {
  title: { default: '星伴管理中心', template: '%s · 星伴管理中心' },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The administration shell is its own route group so that no front-end chrome
 * (Sidebar, Topbar, MobileNav, MaintenanceNotice) is ever mounted for an admin
 * page, and no front-end page can accidentally render admin navigation.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookie = (await cookies()).toString();
  const apiBase = process.env.ADMIN_API_INTERNAL_URL?.trim() || 'http://127.0.0.1:3012';
  const response = await fetch(`${apiBase}/api/admin/auth/session`, {headers: {cookie}, cache: 'no-store'}).catch(() => null);
  if (!response?.ok) redirect('/admin/login');
  return <AdminAccessProvider><AdminShell>{children}</AdminShell></AdminAccessProvider>;
}
