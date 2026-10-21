import type {Metadata} from 'next';
import {DisputeAdmin} from '@/components/admin/disputes';

export const metadata: Metadata = {title: '评理广场'};

export default function AdminDisputesPage() {
  return <DisputeAdmin />;
}
