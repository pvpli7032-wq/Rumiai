import {NextResponse} from 'next/server';
import {requireUser,unauthorized} from '@rumiai/backend/infrastructure/http';
import {listStorySaves,createStorySave,deleteStorySave,restoreStorySave} from '@rumiai/backend/modules/stories/lifecycle/save-service';
import {storyErrorResponse} from '../../errors';
type Context={params:Promise<{id:string}>};
export async function GET(r:Request,c:Context){try{const u=await requireUser(r);if(!u)return unauthorized();return NextResponse.json(await listStorySaves(u.userId,(await c.params).id,new URL(r.url).searchParams.get('cursor')),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return storyErrorResponse(e,'story saves GET');}}
export async function POST(r:Request,c:Context){try{const u=await requireUser(r);if(!u)return unauthorized();const body=await r.json(),id=(await c.params).id;if(body.action==='restore')return NextResponse.json(await restoreStorySave(u.userId,id,String(body.saveId??''),body));return NextResponse.json(await createStorySave(u.userId,id,body));}catch(e){return storyErrorResponse(e,'story saves POST');}}
export async function DELETE(r:Request,c:Context){try{const u=await requireUser(r);if(!u)return unauthorized();return NextResponse.json(await deleteStorySave(u.userId,(await c.params).id,new URL(r.url).searchParams.get('saveId')??''));}catch(e){return storyErrorResponse(e,'story saves DELETE');}}
