import { CreatorConnections } from '@/components/creator-connections';

export const dynamic = 'force-dynamic';
export default async function CreatorConnectionsPage({ params: paramsPromise, searchParams: searchParamsPromise }: { params: Promise<{ username: string }>; searchParams: Promise<{ type?: string }> }) {
  const params = await paramsPromise;
  const searchParams = await searchParamsPromise;

  const type = searchParams.type === 'following' ? 'following' : 'followers';
  return <CreatorConnections username={params.username} type={type} />;
}
