import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ sign: string }> }) {
  const params = await paramsPromise;

  try {
    const sign = params.sign.toLowerCase();
    const data = await db.horoscope.findUnique({
      where: { sign },
      select: {
        sign: true, thaiName: true, title: true, description: true,
        luckyNumber: true, luckyColor: true, compatibility: true, advice: true,
      },
    });

    if (!data) {
      const all = await db.horoscope.findMany({ select: { sign: true }, orderBy: { sign: 'asc' } });
      return NextResponse.json(
        { error: `Invalid zodiac sign: ${sign}. Valid signs: ${all.map((s) => s.sign).join(', ')}` },
        { status: 400 },
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    logRouteError('GET /api/horoscope/[sign]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
