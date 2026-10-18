'use client';
import Link from 'next/link';
import {useAdminAccess} from './use-admin-access';

export function AdminEntry() {
  const {access} = useAdminAccess();
  if (!access || !Object.values(access).some(Boolean)) return null;
  return <Link href="/admin" className="flex min-h-12 items-center justify-between rounded-xl border border-border p-4">管理后台 <span>进入管理 →</span></Link>;
}
