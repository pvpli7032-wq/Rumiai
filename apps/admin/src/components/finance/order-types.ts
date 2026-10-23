/** 财务订单列表与订单详情抽屉共用的视图类型：一处定义，两边都按它渲染。 */

export type RefundSummary = {
  refundNo: string | null;
  membershipRefundId?: string;
  status: string;
  /** 列表投影里有，退款台账走同一个接口所以可能缺。 */
  amountCnyCents?: number;
  coinAmount?: number;
  errorCode: string | null;
  completedAt: string | null;
};
export type CallbackEvent = {provider: string; providerTradeNo: string; outcome: string; reasonCode: string | null; receivedAt: string};

/**
 * 订单行。两个接口的投影不同：订单列表带套餐构成、创建时间与验签回调，
 * 退款接口只带金额、金币与退款快照。缺字段一律按「未返回」渲染，不猜值。
 */
export type OrderRow = {
  orderNo: string;
  orderType?: 'COINS' | 'MEMBERSHIP';
  membershipOrder?: {orderNo: string; amountCents: number; status: string} | null;
  status: string;
  provider: string;
  providerTradeNo: string | null;
  currency?: string;
  amountCnyCents: number;
  packageCoins?: number;
  packageBonus?: number;
  coinAmount: number;
  createdAt?: string;
  paidAt: string | null;
  refund: RefundSummary | null;
  callbackEvents?: CallbackEvent[];
};

/** 订单详情用的退款全貌：比列表多审批链与理由，决定详情里能出哪些动作。 */
export type RefundDetail = {
  refundNo: string;
  status: string;
  amountCnyCents: number;
  coinAmount: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  requestedByMe: boolean;
  reason: string;
  approvedAt: string | null;
  approvalReason: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
};

export const STATUS_LABEL: Record<string, string> = {
  PENDING: '待支付', PAID: '已支付', REFUND_PENDING: '退款处理中', REFUNDED: '已退款', FAILED: '支付失败',
  PROCESSING: '渠道处理中', UNKNOWN: '结果待核对', SUCCEEDED: '退款成功',
  PENDING_APPROVAL: '待审批', REJECTED: '审批驳回',
};
