/** Browser-safe product event names shared by client telemetry and server readers. */
export type ProductEventName =
  | 'mirror_visited' | 'mirror_started' | 'mirror_completed' | 'mirror_share_viewed' | 'mirror_to_chat'
  | 'dispute_visited' | 'dispute_started' | 'dispute_voted' | 'dispute_closed'
  | 'invite_visited' | 'invite_registered' | 'invite_first_chat';
