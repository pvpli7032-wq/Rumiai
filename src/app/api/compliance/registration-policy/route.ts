import {NextResponse} from 'next/server';
import {readRegistrationPolicy} from '@/lib/compliance/policy-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
export async function GET(){
  try{return NextResponse.json(await readRegistrationPolicy(),{headers:{'Cache-Control':'no-store'}});}
  catch(error){logRouteError('GET /api/compliance/registration-policy',error);return NextResponse.json({error:'无法读取注册确认要求。'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
