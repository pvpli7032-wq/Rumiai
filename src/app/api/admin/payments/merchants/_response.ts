import {NextResponse} from 'next/server';
import {logRouteError} from '@/lib/logger';
import {privateHeaders, readJsonBody} from '@/lib/http';
import {PaymentMerchantError} from '@/lib/payments/merchant-config-service';
export {privateHeaders};
export function merchantErrorResponse(error:unknown,route:string){if(error instanceof PaymentMerchantError)return NextResponse.json({error:error.message},{status:error.status,headers:privateHeaders});logRouteError(route,error);return NextResponse.json({error:'支付商户管理操作失败，请核对状态后重试。'},{status:500,headers:privateHeaders});}
export const readMerchantJson = (request: Request) => readJsonBody(request, {maxBytes: 30_000});
