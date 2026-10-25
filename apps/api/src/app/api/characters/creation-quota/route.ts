import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {readCreatorCharacterQuota} from '@rumiai/backend/modules/characters/creator-service';
import {jsonError, privateHeaders, unauthorized} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  try {return NextResponse.json(await readCreatorCharacterQuota(user.userId), {headers: privateHeaders});}
  catch (error) {return jsonError(error, 'GET /api/characters/creation-quota', '角色创建额度读取失败，请重试。');}
}
