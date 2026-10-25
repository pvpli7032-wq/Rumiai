import {createHash} from 'node:crypto';
import type {NotificationType} from '@rumiai/contracts/notifications/types';

/** Stable event identity, shared by writes and deferred-event revalidation. */
export function notificationId(userId:string,type:NotificationType,eventKey:string):string {
  return 'ntf_'+createHash('sha256').update([userId,type,eventKey].join('\u0000')).digest('hex').slice(0,24);
}
