import {AiCostManagement} from '@/components/admin/ai-costs/ai-cost-management';
import {ModelPriceManagement} from '@/components/admin/ai-costs/model-price-management';

export default function AiCostsPage() {
  return <AiCostManagement><ModelPriceManagement /></AiCostManagement>;
}
