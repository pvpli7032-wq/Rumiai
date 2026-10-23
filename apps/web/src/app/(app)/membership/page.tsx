import type { Metadata } from 'next';
import { MembershipCatalog } from '@/components/memberships/membership-catalog';
export const metadata: Metadata = {title: '会员中心'};
export default function MembershipPage() { return <MembershipCatalog />; }
