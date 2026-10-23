import type {Metadata} from 'next';
import {Workbench} from '@admin/components/workbench';

export const metadata: Metadata = {title: '工作台'};

export default function AdminPage() {
  return <Workbench />;
}
