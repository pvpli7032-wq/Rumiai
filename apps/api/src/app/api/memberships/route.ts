import { NextResponse } from 'next/server';
import { readMembershipCatalogue } from '@rumiai/backend/modules/memberships/service';

export const dynamic = 'force-dynamic';
export async function GET() {
  const catalog = await readMembershipCatalogue();
  return NextResponse.json({policy: catalog.policy, benefitDefinitions: catalog.benefitDefinitions, plans: catalog.plans.filter(plan => plan.isActive && plan.priceCents !== null && plan.priceCents > 0)}, {headers: {'Cache-Control': 'private, no-store'}});
}
