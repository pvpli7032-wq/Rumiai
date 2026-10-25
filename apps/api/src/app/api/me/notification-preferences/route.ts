import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {privateHeaders,unauthorized} from '@rumiai/backend/infrastructure/http';
import {readNotificationPreferences,saveNotificationPreferences,NotificationPreferenceError} from '@rumiai/backend/modules/notifications/preferences-service';
export const dynamic='force-dynamic';
export async function GET(request:Request){const auth=await getAuthUser(request);if(!auth)return unauthorized();return NextResponse.json(await readNotificationPreferences(auth.userId),{headers:privateHeaders});}
export async function PUT(request:Request){const auth=await getAuthUser(request);if(!auth)return unauthorized();try{return NextResponse.json(await saveNotificationPreferences(auth.userId,await request.json()),{headers:privateHeaders});}catch(error){return NextResponse.json({error:error instanceof NotificationPreferenceError?error.message:'通知设置保存失败。'},{status:error instanceof NotificationPreferenceError?error.status:500,headers:privateHeaders});}}
