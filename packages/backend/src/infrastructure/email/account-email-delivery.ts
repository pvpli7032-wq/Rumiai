import {createHash} from 'node:crypto';

export type AccountEmailPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'ACCOUNT_ACTIVATION';
export type AccountEmailMessage = {email: string; purpose: AccountEmailPurpose; token: string; expiresAt: Date};
export interface AccountEmailDelivery {deliver(message: AccountEmailMessage): Promise<void>}

const developmentOutbox: AccountEmailMessage[] = [];
export class AccountEmailDeliveryUnavailableError extends Error {
  constructor() {super('Account email delivery is not configured'); this.name = 'AccountEmailDeliveryUnavailableError';}
}
export class AccountEmailDeliveryFailedError extends Error {
  constructor() {super('Account email delivery failed'); this.name = 'AccountEmailDeliveryFailedError';}
}

function configuration() {
  if (process.env.ACCOUNT_EMAIL_DELIVERY !== 'resend') return null;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ACCOUNT_EMAIL_FROM?.trim();
  const rawSite = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!apiKey || !from || /[\r\n]/.test(from) || !rawSite) return null;
  try {
    const site = new URL(rawSite);
    if (site.username || site.password || !['http:', 'https:'].includes(site.protocol)) return null;
    if (process.env.NODE_ENV === 'production' && site.protocol !== 'https:') return null;
    return {apiKey, from, site: site.origin};
  } catch {return null;}
}

export function accountEmailDeliveryConfigured(): boolean {
  return (process.env.NODE_ENV !== 'production' && process.env.ACCOUNT_EMAIL_DELIVERY === 'memory') || configuration() !== null;
}

/** Server-only transactional delivery. Secrets and recovery links never enter logs. */
export function accountEmailDelivery(): AccountEmailDelivery {
  if (process.env.NODE_ENV !== 'production' && process.env.ACCOUNT_EMAIL_DELIVERY === 'memory') {
    return {deliver: async message => {developmentOutbox.push(message);}};
  }
  const config = configuration();
  if (!config) return {deliver: async () => {throw new AccountEmailDeliveryUnavailableError();}};
  return {
    async deliver(message) {
      const actions: Record<AccountEmailPurpose, {path: string; title: string}> = {
        PASSWORD_RESET: {path: '/reset-password', title: '重置密码'},
        EMAIL_VERIFICATION: {path: '/verify-email', title: '验证邮箱'},
        ACCOUNT_ACTIVATION: {path: '/activate-account', title: '激活账号'},
      };
      const action = actions[message.purpose];
      const link = new URL(action.path, config.site);
      link.searchParams.set('token', message.token);
      const text = [
        '你正在申请' + action.title + '。',
        '请打开以下链接完成操作：',
        link.href,
        '链接有效期至 ' + message.expiresAt.toISOString() + '。',
        '如果不是你本人申请，请忽略本邮件。',
      ].join('\n\n');
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + config.apiKey,
            'Idempotency-Key': 'account-' + createHash('sha256').update(message.purpose + ':' + message.token).digest('hex'),
          },
          body: JSON.stringify({from: config.from, to: [message.email], subject: action.title, text}),
          signal: AbortSignal.timeout(15_000),
        });
        const result = await response.json().catch(() => null) as {id?: unknown} | null;
        if (!response.ok || typeof result?.id !== 'string' || !result.id) throw new AccountEmailDeliveryFailedError();
      } catch {
        throw new AccountEmailDeliveryFailedError();
      }
    },
  };
}

export function readDevelopmentAccountEmailOutbox(): readonly AccountEmailMessage[] {
  return process.env.NODE_ENV === 'production' ? [] : developmentOutbox;
}
export function clearDevelopmentAccountEmailOutbox(): void {
  if (process.env.NODE_ENV !== 'production') developmentOutbox.length = 0;
}
