import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {readCharacterDraft,saveCharacterDraft,deleteCharacterDraft,CharacterDraftError} from '@rumiai/backend/modules/characters/creator-draft-service';
type Context={params:Promise<{slot:string}>};
const error=(e:unknown)=>e instanceof CharacterDraftError?NextResponse.json({error:e.message},{status:e.status,headers:privateHeaders}):jsonError(e,'creator cloud draft','云草稿操作失败。');
export async function GET(request:Request,c:Context){const user=await requireUser(request);if(!user)return unauthorized();try{return NextResponse.json(await readCharacterDraft(user.userId,(await c.params).slot),{headers:privateHeaders});}catch(e){return error(e);}}
export async function PUT(request:Request,c:Context){const user=await requireUser(request);if(!user)return unauthorized();try{return NextResponse.json(await saveCharacterDraft(user.userId,(await c.params).slot,await request.json()),{headers:privateHeaders});}catch(e){return error(e);}}
export async function DELETE(request:Request,c:Context){const user=await requireUser(request);if(!user)return unauthorized();try{return NextResponse.json(await deleteCharacterDraft(user.userId,(await c.params).slot,Number(new URL(request.url).searchParams.get('version'))),{headers:privateHeaders});}catch(e){return error(e);}}
