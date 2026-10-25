import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {privateHeaders,unauthorized} from '@rumiai/backend/infrastructure/http';
import {readProactiveSubscription,saveProactiveSubscription,cancelProactiveSubscription} from '@rumiai/backend/modules/notifications/proactive-service';
import {NotificationPreferenceError} from '@rumiai/backend/modules/notifications/preferences-service';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
async function handle(request:Request,context:Context,method:'GET'|'PUT'|'DELETE'){const auth=await getAuthUser(request);if(!auth)return unauthorized();try{const {id}=await context.params;const result=method==='GET'?await readProactiveSubscription(auth.userId,id):method==='DELETE'?await cancelProactiveSubscription(auth.userId,id):await saveProactiveSubscription(auth.userId,id,await request.json());return NextResponse.json(result,{headers:privateHeaders});}catch(error){return NextResponse.json({error:error instanceof NotificationPreferenceError?error.message:'主动问候操作失败。'},{status:error instanceof NotificationPreferenceError?error.status:500,headers:privateHeaders});}}
export const GET=(request:Request,context:Context)=>handle(request,context,'GET');
export const PUT=(request:Request,context:Context)=>handle(request,context,'PUT');
export const DELETE=(request:Request,context:Context)=>handle(request,context,'DELETE');
