import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminAccessProvider } from '@/components/admin/use-admin-access';

export const metadata: Metadata = {
  title: { default: '星伴管理中心', template: '%s · 星伴管理中心' },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The administration shell is its own route group so that no front-end chrome
 * (Sidebar, Topbar, MobileNav, MaintenanceNotice) is ever mounted for an admin
 * page, and no front-end page can accidentally render admin navigation.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAccessProvider>
      <AdminShell>{children}</AdminShell>
    </AdminAccessProvider>
  );
}
