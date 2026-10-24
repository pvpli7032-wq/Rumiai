import { Suspense } from 'react';
import { AppFrame } from '@/components/layout/app-frame';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div role="status" className="p-6 text-sm text-muted-foreground">正在加载…</div>}><AppFrame>{children}</AppFrame></Suspense>;
}
