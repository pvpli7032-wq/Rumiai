import { Suspense } from 'react';
import { CircleFeed } from '@/components/circle-feed';
export default async function CirclePage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  return <Suspense fallback={<main className="p-5">正在加载圈子…</main>}><CircleFeed circleId={params.id} /></Suspense>;
}
