import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {GiftCatalogError,readManagedGiftCatalog,saveGiftCatalogItem} from '@/lib/gifts/catalog-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readManagedGiftCatalog(auth.userId),{headers});}
  catch(error){if(error instanceof GiftCatalogError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('GET /api/admin/growth/gifts',error);return NextResponse.json({error:'礼物目录读取失败。'},{status:500,headers});}
}
export async function POST(request:Request){
  const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:'请求数据格式无效。'},{status:400,headers});}
  try{return NextResponse.json(await saveGiftCatalogItem(auth.userId,input),{status:201,headers});}
  catch(error){if(error instanceof GiftCatalogError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('POST /api/admin/growth/gifts',error);return NextResponse.json({error:'礼物目录保存失败。'},{status:500,headers});}
}
