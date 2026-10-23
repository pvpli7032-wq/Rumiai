/**
 * 商户配置的统一入口（V3 支付章）。
 *
 * 具体实现按职责分开：
 * - merchant-guards.ts          入参校验、权限判定、乐观锁
 * - merchant-credentials.ts     密钥加解密与 RSA 格式校验
 * - merchant-config-read.ts     后台读取与本地自检
 * - merchant-config-write.ts    版本写入与旧环境快照
 * - payment-runtime-config.ts   生效配置解析（下单/退款/对账用）
 *
 * 调用方一律从这里取，改内部分文件不影响任何调用点。
 */

export {PaymentMerchantError} from './merchant-guards';

export {readPaymentMerchants, testPaymentMerchant} from './merchant-config-read';

export {savePaymentMerchant} from './merchant-config-write';

export {
  readCheckoutAvailability,
  resolveConfiguredPaymentMerchant,
  resolveNewPaymentConfiguration,
  resolveOrderPaymentConfiguration,
  type PaymentRuntimeConfiguration,
} from './payment-runtime-config';
