import type {Metadata} from 'next';
import {PriceCostAdmin} from '@/components/admin/ai-costs';

export const metadata: Metadata = {title: '价格与成本'};

export default function AiCostsPage() {
  return <PriceCostAdmin />;
}
