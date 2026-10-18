import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { AccountProfileError, readOwnProfile, updateOwnProfile } from '@/lib/accounts/profile-service';

function profileError(error: unknown) {
  if (error instanceof AccountProfileError) return NextResponse.json({error: error.message}, {status: error.status});
  return null;
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const user = await readOwnProfile(auth.userId);
    return NextResponse.json({user, ...user});
  } catch (error) {
    const response = profileError(error);
    if (response) return response;
    logRouteError('GET /api/users/me', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: 'Profile data is invalid'}, {status: 400}); }
    const user = await updateOwnProfile(auth.userId, body);
    return NextResponse.json({user, ...user});
  } catch (error) {
    const response = profileError(error);
    if (response) return response;
    logRouteError('PUT /api/users/me', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
