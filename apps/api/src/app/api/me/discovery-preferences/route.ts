import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {readDiscoveryPreferences,rememberDiscoverySearch,clearDiscoverySearch,DiscoveryPreferenceError} from '@rumiai/backend/modules/discovery/preferences-service';
export const dynamic='force-dynamic';
function error(e:unknown){return e instanceof DiscoveryPreferenceError?NextResponse.json({error:e.message},{status:e.status,headers:privateHeaders}):jsonError(e,'discovery preferences','发现偏好操作失败。');}
export async function GET(request:Request){const user=await requireUser(request);if(!user)return unauthorized();try{return NextResponse.json(await readDiscoveryPreferences(user.userId),{headers:privateHeaders});}catch(e){return error(e);}}
export async function PUT(request:Request){const user=await requireUser(request);if(!user)return unauthorized();try{const body=await request.json();return NextResponse.json(await rememberDiscoverySearch(user.userId,body?.query),{headers:privateHeaders});}catch(e){return error(e);}}
export async function DELETE(request:Request){const user=await requireUser(request);if(!user)return unauthorized();try{return NextResponse.json(await clearDiscoverySearch(user.userId,new URL(request.url).searchParams.get('query')||undefined),{headers:privateHeaders});}catch(e){return error(e);}}
