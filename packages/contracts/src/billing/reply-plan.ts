import type {QuoteResult} from './types';

export interface ReplyPlanLine {
  modelKey: string;
  displayName: string;
  coins: number;
  baseCoins: number;
  multiplier: number;
  pricing: QuoteResult['pricing'];
  priceSource: QuoteResult['priceSource'];
}

/** Public reply-model and price projection; never contains provider credentials. */
export interface ReplyPlan {
  models: ReplyPlanLine[];
  defaultModelKey: string | null;
  defaultLine: ReplyPlanLine | null;
  chargingEnabled: boolean;
}
