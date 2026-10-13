'use client';
import { zhText } from '@/lib/zh-text';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

/** Sticky top bar shown above the main column (brand on mobile, coins + account always). */
export function Topbar() {
  const { user, isLoading } = useAuth();

  return (
    <div className="sticky top-0 z-50 border-b border-transparent bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-16 w-full items-center gap-2 p-4">
        <Link href="/" className="font-athiti text-xl font-bold desktop:hidden">
          <span className="bg-linear-to-r/srgb from-[#EE4036] to-[#FAAF40] bg-clip-text text-transparent">{zhText("Khui AI")}</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/shop"
            className="flex h-9 items-center rounded-full bg-white px-4 shadow-sm transition-colors hover:border hover:border-zinc-200 dark:bg-[#F4B208]/10 dark:hover:bg-[#F4B208]/20"
          >
            <span className="mr-1">🪙</span>
            <span className="font-athiti font-bold">{user?.coins ?? 0}</span>
          </Link>

          <button
            aria-label={zhText("การแจ้งเตือน")}
            className="relative flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white transition-colors dark:border-transparent dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            <Bell className="h-4 w-4" />
          </button>

          {!isLoading &&
            (user ? (
              <Link href="/profile" aria-label={zhText("โปรไฟล์")}>
                <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-linear-to-br/srgb from-[#EE4036] to-[#FAAF40] text-sm font-bold text-white dark:border-zinc-800">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.username} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    user.username[0]?.toUpperCase()
                  )}
                </span>
              </Link>
            ) : (
              <Link
                href="/login"
                className="flex h-9 items-center rounded-full bg-linear-to-r/srgb from-[#EE4036] to-[#FAAF40] px-4 font-athiti text-sm font-bold text-white"
              >
                {zhText("เข้าสู่ระบบ")}</Link>
            ))}
        </div>
      </div>
    </div>
  );
}
