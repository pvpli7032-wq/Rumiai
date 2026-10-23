export const ADMIN_CHARGE_STATUSES = ['HELD','UNKNOWN','SETTLED','RELEASED'] as const;
export type AdminChargeStatus = typeof ADMIN_CHARGE_STATUSES[number];
export interface AdminChargeItem {id:string;userId:string;userName:string;operation:string;status:AdminChargeStatus;coins:number;allowanceSource:string|null;conversationId:string|null;heldAt:string;settledAt:string|null;releasedAt:string|null;ageMinutes:number}
export interface AdminChargePage {items:AdminChargeItem[];nextCursor:string|null;summary:{held:number;unknown:number;heldCoins:number;unknownCoins:number}}
