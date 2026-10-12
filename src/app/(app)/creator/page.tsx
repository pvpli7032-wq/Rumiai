import CreatorForm from './creator-form';
export default async function CreatorPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ edit?: string }> }) {
  const searchParams = await searchParamsPromise;
  return <CreatorForm key={searchParams.edit || 'new'} editId={typeof searchParams.edit === 'string' ? searchParams.edit : undefined} />;
}
