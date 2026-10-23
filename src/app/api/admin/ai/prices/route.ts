import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {readAiModelPriceSettings,saveAiModelPrice,AiModelPriceError} from '@/lib/ai/costs/model-price-service';
import {privateHeaders} from '../costs/_response';

export const dynamic='force-dynamic';
function response(error:unknown,statusDefault=500){
  const status=error instanceof AiModelPriceError?error.status:statusDefault;
  const message=error instanceof Error?error.message:'模型价格请求失败。';
  return NextResponse.json({error:message},{status,headers:privateHeaders});
}
export async function GET(request:Request){
  try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});return NextResponse.json(await readAiModelPriceSettings(auth.userId),{headers:privateHeaders});}
  catch(error){return response(error);}
}
export async function POST(request:Request){
  try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:'模型价格数据格式不正确。'},{status:400,headers:privateHeaders});}return NextResponse.json(await saveAiModelPrice(auth.userId,input),{status:201,headers:privateHeaders});}
  catch(error){return response(error);}
}
