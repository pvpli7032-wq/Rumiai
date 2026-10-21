import type {Metadata} from 'next';
import {SettingsCenter} from '@/components/admin/settings';

export const metadata: Metadata = {title: '设置中心'};

export default function AdminSettingsPage() {
  return <SettingsCenter />;
}
