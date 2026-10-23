import type { Metadata } from 'next';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {AdminShell} from '@/components/admin/admin-shell';
import {AdminAccessProvider} from '@/components/admin/use-admin-access';
import {ADMIN_SESSION_COOKIE} from '@/lib/admin-auth/cookies';
import {getAdminAuthUser, readAdminSessionState} from '@/lib/admin-auth/service';

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
  const user = await getAdminAuthUser((await cookies()).get(ADMIN_SESSION_COOKIE)?.value ?? null);
  if (!user || !await readAdminSessionState(user.userId)) redirect('/admin/login');
  return <AdminAccessProvider><AdminShell>{children}</AdminShell></AdminAccessProvider>;
}
