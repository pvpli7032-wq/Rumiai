import type {Metadata} from 'next';
import {TasksAdmin} from '@admin/components/tasks';

export const metadata: Metadata = {title: '后台任务'};

export default function AdminTasksPage() {
  return <TasksAdmin />;
}
