import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {GiftCatalogError,saveGiftCatalogItem} from '@/lib/gifts/catalog-service';
import {logRouteError} from '@/lib/logger';

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:{'Cache-Control':'private, no-store'}});
  let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:'请求数据格式无效。'},{status:400});}
  try{return NextResponse.json(await saveGiftCatalogItem(auth.userId,{...(input as object),id:(await params).id}));}
  catch(error){if(error instanceof GiftCatalogError)return NextResponse.json({error:error.message},{status:error.status});logRouteError('PATCH /api/admin/growth/gifts/[id]',error);return NextResponse.json({error:'礼物目录保存失败。'},{status:500});}
}
