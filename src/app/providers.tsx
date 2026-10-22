'use client';
import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/lib/auth-context';

/**
 * 主题：默认仍是深色，但打开了 enableSystem，用户可以自己切浅色 / 深色 / 跟随系统。
 *
 * defaultTheme 暂时不改 light：前台还有一批组件把深色写死在基础类里（bg-zinc-950 /
 * text-white / border-white/10，没有 light 分支），改默认值会变成「浅色底 + 浅色字」
 * 直接看不清。等那些组件补上浅色分支再切默认值。切换入口在后台顶栏（ThemeToggle）。
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
