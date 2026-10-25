import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {setHiddenCharacter,DiscoveryPreferenceError} from '@rumiai/backend/modules/discovery/preferences-service';
type Context={params:Promise<{id:string}>};
async function change(request:Request,context:Context,hidden:boolean){const user=await requireUser(request);if(!user)return unauthorized();try{return NextResponse.json(await setHiddenCharacter(user.userId,(await context.params).id,hidden),{headers:privateHeaders});}catch(e){return e instanceof DiscoveryPreferenceError?NextResponse.json({error:e.message},{status:e.status,headers:privateHeaders}):jsonError(e,'hidden character','角色偏好操作失败。');}}
export const PUT=(r:Request,c:Context)=>change(r,c,true);
export const DELETE=(r:Request,c:Context)=>change(r,c,false);
