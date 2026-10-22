/** 后台「支付商户」页用到的两个视图类型：列表行与表单草稿。 */

export type Merchant = {
  id: string;
  name: string;
  provider: string;
  environment: string;
  isActive: boolean;
  version: number;
  currentRevision: {
    revision: number;
    merchantNo: string;
    apiBaseUrl: string;
    refundsEnabled: boolean;
    createdAt: string;
    hasMerchantPrivateKey: boolean;
    hasPlatformPublicKey: boolean;
  } | null;
};

export type MerchantDraft = {
  id?: string;
  version: number;
  name: string;
  environment: 'TEST' | 'PRODUCTION';
  isActive: boolean;
  merchantNo: string;
  apiBaseUrl: string;
  merchantPrivateKey: string;
  platformPublicKey: string;
  refundsEnabled: boolean;
  reason: string;
};

/** 两个环境的默认服务地址；切换环境时地址跟着走，避免手填出错。 */
export const ENVIRONMENT_BASE_URL: Record<MerchantDraft['environment'], string> = {
  TEST: 'http://127.0.0.1:19090',
  PRODUCTION: 'https://www.ezfp.cn',
};

export function newDraft(): MerchantDraft {
  return {
    version: 0,
    name: '',
    environment: 'TEST',
    isActive: false,
    merchantNo: '',
    apiBaseUrl: ENVIRONMENT_BASE_URL.TEST,
    merchantPrivateKey: '',
    platformPublicKey: '',
    refundsEnabled: false,
    reason: '',
  };
}

export function draftFromMerchant(merchant: Merchant): MerchantDraft {
  return {
    id: merchant.id,
    version: merchant.version,
    name: merchant.name,
    environment: merchant.environment === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
    isActive: merchant.isActive,
    merchantNo: merchant.currentRevision?.merchantNo ?? '',
    apiBaseUrl: merchant.currentRevision?.apiBaseUrl ?? ENVIRONMENT_BASE_URL.TEST,
    merchantPrivateKey: '',
    platformPublicKey: '',
    refundsEnabled: merchant.currentRevision?.refundsEnabled ?? false,
    reason: '',
  };
}
