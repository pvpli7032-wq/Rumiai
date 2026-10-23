import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {readPaymentMerchants,savePaymentMerchant} from '@rumiai/backend/modules/payments/merchant-config-service';
import {merchantErrorResponse,privateHeaders,readMerchantJson} from './_response';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});return NextResponse.json(await readPaymentMerchants(auth.userId),{headers:privateHeaders});}catch(error){return merchantErrorResponse(error,'GET /api/admin/payments/merchants');}}
export async function POST(request:Request){try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const parsed=await readMerchantJson(request);if('response'in parsed)return parsed.response;return NextResponse.json(await savePaymentMerchant(auth.userId,parsed.input),{status:201,headers:privateHeaders});}catch(error){return merchantErrorResponse(error,'POST /api/admin/payments/merchants');}}
