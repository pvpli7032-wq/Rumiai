import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {StickerError,readManagedStickers,saveSticker} from '@rumiai/backend/modules/conversations/stickers/service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
async function handle(request:Request){try{const user=await getAdminRequestUser(request);if(!user)return NextResponse.json({error:'请先登录。'},{status:401});const result=request.method==='GET'?await readManagedStickers(user.userId):await saveSticker(user.userId,await request.json(),request.method==='DELETE');return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});}catch(error){if(error instanceof StickerError)return NextResponse.json({error:error.message},{status:error.status});if(error instanceof SyntaxError)return NextResponse.json({error:'请求格式无效。'},{status:400});logRouteError('admin/chat/stickers',error);return NextResponse.json({error:'表情包操作失败。'},{status:500});}}
export const GET=handle;export const POST=handle;export const DELETE=handle;
