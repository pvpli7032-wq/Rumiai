'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {ShieldCheck} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';
import {api} from '@/lib/api-client';
import {API} from '@/lib/api-paths';

type AdminSession = {permissions: string[]; roles: string[]; enabled: boolean};

/**
 * 个人页上的「管理后台」入口。只读一次 /api/admin/session 判断有没有任意管理权限，
 * 不引入后台组件，前台也就不依赖任何 admin 目录下的代码。
 */
export function AdminEntry() {
  const {token} = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!token) {
      setVisible(false);
      return;
    }
    const controller = new AbortController();
    void api
      .get<AdminSession>(API.admin.session, {token, signal: controller.signal})
      .then(session => {
        if (!controller.signal.aborted) setVisible(Boolean(session.enabled) && session.permissions.length > 0);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [token]);

  if (!visible) return null;
  return (
    <Link
      href="/admin"
      className="flex min-h-12 items-center justify-between rounded-xl border border-border p-4"
    >
      <span className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-brand-strong" />
        管理后台
      </span>
      <span className="text-sm text-muted-foreground">进入管理 →</span>
    </Link>
  );
}
