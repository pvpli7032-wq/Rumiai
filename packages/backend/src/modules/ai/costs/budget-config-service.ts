import type {Prisma} from '@prisma/client';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {budgetCircuitBreakerMode, parseDailyBudgets, type DailyCostBudget} from '@rumiai/backend/modules/ai/budget-config';

type BudgetReader=Pick<Prisma.TransactionClient,'aiDailyCostBudget'|'aiCostPolicy'>;
type BudgetRow={currency:string;siteLimit:number|null;userLimit:number|null;isActive:boolean;version:number;updatedBy:string;updatedAt:Date};

function recordBudget(row:BudgetRow):DailyCostBudget{
  return {
    ...(row.siteLimit===null?{}:{site:row.siteLimit}),
    ...(row.userLimit===null?{}:{user:row.userLimit}),
  };
}

/** Persisted budgets are authoritative after first use; environment values remain a migration fallback. */
export async function readAiDailyBudgetConfiguration(reader:BudgetReader=db){
  const [rows,policy]=await Promise.all([
    reader.aiDailyCostBudget.findMany({orderBy:{currency:'asc'}}),
    reader.aiCostPolicy.findUnique({where:{id:'GLOBAL'}}),
  ]);
  let source:'DATABASE'|'ENVIRONMENT'|'NONE'='NONE';
  let budgets:Record<string,DailyCostBudget>|null=null;
  let status:'enabled'|'disabled'|'invalid'='disabled';

  if(rows.length){
    source='DATABASE';
    const active=rows.filter(row=>row.isActive);
    if(active.length){
      budgets=Object.fromEntries(active.map(row=>[row.currency,recordBudget(row)]));
      status='enabled';
    }
  }else{
    try{
      budgets=parseDailyBudgets(process.env.AI_DAILY_COST_BUDGETS);
      if(budgets){source='ENVIRONMENT';status='enabled';}
    }catch{
      source='ENVIRONMENT';
      status='invalid';
    }
  }

  const circuitBreaker=policy
    ? policy.circuitBreakerEnabled?'enabled':'disabled'
    : budgetCircuitBreakerMode();
  return {
    source,
    status,
    budgets,
    circuitBreaker,
    circuitBreakerVersion:policy?.version??0,
    circuitBreakerUpdatedAt:policy?.updatedAt??null,
    rows:rows.map(row=>({
      currency:row.currency,
      siteLimit:row.siteLimit,
      userLimit:row.userLimit,
      isActive:row.isActive,
      version:row.version,
      updatedAt:row.updatedAt,
    })),
  };
}

