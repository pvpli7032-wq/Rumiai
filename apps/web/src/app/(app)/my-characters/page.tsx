import {Suspense} from 'react';
import MyCharactersPage from '@/components/creator/my-characters-page';
export default function Page() { return <Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">正在加载作品…</p>}><MyCharactersPage /></Suspense>; }
