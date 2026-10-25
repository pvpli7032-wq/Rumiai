import {redirect} from 'next/navigation';
import {safeNextPath} from '@web/lib/next-path';
/** Legacy authentication links retain their destination in the current account UI. */
export default async function AuthPage({searchParams}:{searchParams:Promise<{next?:string;invite?:string}>}){
  const query=await searchParams;
  const params=new URLSearchParams({next:safeNextPath(query.next)});
  if(query.invite)params.set('invite',query.invite);
  redirect(`/login?${params}`);
}
