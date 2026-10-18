import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {testPaymentMerchant} from '@/lib/payments/merchant-config-service';
import {merchantErrorResponse,privateHeaders} from '../../_response';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const {id}=await params;return NextResponse.json(await testPaymentMerchant(auth.userId,id),{headers:privateHeaders});}catch(error){return merchantErrorResponse(error,'POST /api/admin/payments/merchants/[id]/test');}}
