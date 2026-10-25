/** Browser-safe product event names shared by client telemetry and server readers. */
export type ProductEventName =
  | 'mirror_visited' | 'mirror_started' | 'mirror_completed' | 'mirror_share_viewed' | 'mirror_to_chat'
  | 'dispute_visited' | 'dispute_started' | 'dispute_voted' | 'dispute_closed'
  | 'invite_visited' | 'invite_registered' | 'invite_first_chat' | 'chat_opened';


/** Clients may report navigation only; completion facts are owned by server workflows. */
export const CLIENT_PRODUCT_EVENTS: readonly ProductEventName[] = [
  'mirror_visited', 'mirror_started', 'mirror_share_viewed', 'mirror_to_chat', 'dispute_visited', 'chat_opened',
];
export interface ChatOnboardingFunnel {
  opened: number; firstReply: number; thirdReply: number;
  firstReplyRate: number | null; thirdReplyRate: number | null;
  nextDayMatured: number; nextDayReturned: number; nextDayRate: number | null;
  trackingSince: string | null;
}
