'use client';

import {ShieldCheck} from 'lucide-react';

/**
 * 仅提供独立后台登录入口；前台不读取管理会话或用用户 Token 探测管理权限。
 */
export function AdminEntry() {
  return (
    <a
      href="/admin/login"
      className="flex min-h-12 items-center justify-between rounded-xl border border-border p-4"
    >
      <span className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-brand-strong" />
        管理后台
      </span>
      <span className="text-sm text-muted-foreground">进入管理 →</span>
    </a>
  );
}
