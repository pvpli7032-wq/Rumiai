import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {logRouteError} from '@/lib/logger';
import {BackupCatalogError,readManagedBackups} from '@/lib/operations/backup-read-service';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  const page=new URL(request.url).searchParams.get('page')??'1';if(!/^[1-9]\d{0,4}$/.test(page))return NextResponse.json({error:'备份清单页码无效。'},{status:400,headers});
  try{return NextResponse.json(await readManagedBackups(auth.userId,Number(page)),{headers});}
  catch(error){if(error instanceof BackupCatalogError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('GET /api/admin/operations/backups',error);return NextResponse.json({error:'备份清单读取失败。'},{status:503,headers});}
}
