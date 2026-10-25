import {NextResponse} from 'next/server';
import {readStickers} from '@rumiai/backend/modules/conversations/stickers/service';
export async function GET(){return NextResponse.json(await readStickers(),{headers:{'Cache-Control':'no-store'}});}
