import {Suspense} from 'react';
import {CircleDiscovery} from '@/components/circles/circle-discovery';

function CirclesLoading() {
  return <main className="mx-auto w-full max-w-3xl p-5" role="status">正在加载圈子…</main>;
}

export default function CirclesPage() {
  return <Suspense fallback={<CirclesLoading />}><CircleDiscovery /></Suspense>;
}