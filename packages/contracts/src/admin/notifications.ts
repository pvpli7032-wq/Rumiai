export interface NotificationTypeStat {type:string;label:string;sent:number;unread:number;read:number;readRate:number|null}
export type NotificationTotals = Omit<NotificationTypeStat,'type'|'label'>;
export interface NotificationStats {generatedAt:string;since:string;days:number;rows:NotificationTypeStat[];totals:NotificationTotals}
