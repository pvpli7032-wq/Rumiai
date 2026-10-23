import type { Metadata } from 'next';
import { MembershipManagement } from '@admin/components/memberships/membership-management';
export const metadata: Metadata = {title: '会员方案'};
export default function MembershipAdminPage() { return <MembershipManagement />; }
