import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readManagedCharacterModels,saveManagedCharacterModels} from '@/lib/characters/model-access-service';
import {managementError,privateHeaders} from '../../_response';

type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
  try{const actor=await getAuthUser(request);if(!actor)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});return NextResponse.json(await readManagedCharacterModels(actor.userId,(await context.params).id),{headers:privateHeaders});}
  catch(error){return managementError(error,'GET /api/characters/management/[id]/models');}
}
export async function PUT(request:Request,context:Context){
  try{const actor=await getAuthUser(request);if(!actor)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});return NextResponse.json(await saveManagedCharacterModels(actor.userId,(await context.params).id,await request.json().catch(()=>null)),{headers:privateHeaders});}
  catch(error){return managementError(error,'PUT /api/characters/management/[id]/models');}
}
