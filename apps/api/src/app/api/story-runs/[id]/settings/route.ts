import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {readStorySceneSettings,updateStorySceneSettings} from '@rumiai/backend/modules/stories/lifecycle/settings-service';
import {storyErrorResponse} from '../../errors';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{const user=await getAuthUser(request);if(!user)return NextResponse.json({error:'请先登录。'},{status:401});return NextResponse.json(await readStorySceneSettings(user.userId,(await params).id),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return storyErrorResponse(e,'GET story settings');}
}
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 try{const user=await getAuthUser(request);if(!user)return NextResponse.json({error:'请先登录。'},{status:401});return NextResponse.json(await updateStorySceneSettings(user.userId,(await params).id,await request.json().catch(()=>null)),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return storyErrorResponse(e,'PUT story settings');}
}
