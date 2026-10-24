import CreatorForm from '@/components/creator/creator-form';
import {CreatorDashboard} from '@/components/creator/creator-dashboard';
export default async function CreatorPage({ searchParams: query }: { searchParams: Promise<{ edit?: string; new?: string }> }) { const searchParams=await query; const editId=typeof searchParams.edit==='string'?searchParams.edit:undefined; return editId||searchParams.new==='1'?<CreatorForm key={editId||'new'} editId={editId}/>:<CreatorDashboard/>; }
