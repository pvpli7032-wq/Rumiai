'use client';
import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@web/lib/auth-context';
import { NavigationHistoryBoundary } from '@/components/layout/navigation-history';
import { PwaController } from '@/components/layout/pwa-controller';

/**
 * 主题：light 是首次访问的默认值；next-themes 继续使用 theme localStorage 键，
 * 因此已有的 light/dark/system 选择会优先于默认值。
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" storageKey="theme" defaultTheme="light" enableSystem>
      <AuthProvider>
        <NavigationHistoryBoundary />
        {children}
        <PwaController />
      </AuthProvider>
    </ThemeProvider>
  );
}
