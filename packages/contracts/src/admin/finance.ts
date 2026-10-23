export interface FinanceReport {
  generatedAt:string; since:string; days:number; paidOrders:number; paidAmountCnyCents:number; completedRefunds:number; refundedAmountCnyCents:number; netAfterRefundsCnyCents:number;
  orderAnomalies:Array<{orderNo:string;status:string;expectedCoins:number;actualCoins:number|null}>; orderAnomaliesTruncated:boolean;
  refundAnomalies:Array<{orderNo:string;refundNo:string|null;refundStatus:string|null;orderStatus:string;expectedCoins:number|null;debitCoins:number|null;releaseCoins:number|null}>; refundAnomaliesTruncated:boolean;
  negativeBalances:Array<{id:string;coins:number}>; negativeBalancesTruncated:boolean;
  aiCosts:Array<{currency:string;estimatedCost:number;calls:number;knownCostCalls:number;unknownCostCalls:number;mockCalls:number;failedCalls:number;costPerThousandCalls:number|null;realCalls:number;[key:string]:unknown}>;
  aiBudget:{status:string; circuitBreaker:string; pricingConfigured:boolean; unknownCostCalls:number; alerts:Array<{scope:string;currency:string;userId?:string;knownCost:number;budget:number}>; alertsTruncated:boolean; unbudgetedCurrencies:string[]; budgets:Record<string,{site?:number;user?:number}>};
  validationMetrics:any;
}

export type FinanceOrderType = 'COINS' | 'MEMBERSHIP';
