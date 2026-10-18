import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {logRouteError} from '@/lib/logger';
import {CertificateStatusError,readSiteCertificateStatus,checkSiteCertificate} from '@/lib/operations/certificate-service';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(error:unknown,method:string){
  if(error instanceof CertificateStatusError)return NextResponse.json({error:error.message},{status:error.status,headers});
  logRouteError(`${method} /api/admin/operations/certificate`,error);
  return NextResponse.json({error:'证书检查状态暂不可用。'},{status:503,headers});
}
export async function GET(request:Request){
  const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readSiteCertificateStatus(auth.userId),{headers});}catch(error){return failure(error,'GET');}
}
export async function POST(request:Request){
  const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await checkSiteCertificate(auth.userId),{headers});}catch(error){return failure(error,'POST');}
}
