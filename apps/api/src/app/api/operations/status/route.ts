import {NextResponse} from 'next/server';
import {readPublicMaintenance} from '@rumiai/backend/modules/operations/maintenance-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
export const dynamic='force-dynamic';
export async function GET(){
  try{return NextResponse.json(await readPublicMaintenance(),{headers:{'Cache-Control':'no-store'}});}
  catch(error){logRouteError('GET /api/operations/status',error);return NextResponse.json({error:'维护状态暂不可用。'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
