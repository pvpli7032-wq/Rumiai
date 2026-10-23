export type AccountEmailPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export type AccountEmailMessage = {
  email: string;
  purpose: AccountEmailPurpose;
  token: string;
  expiresAt: Date;
};

export interface AccountEmailDelivery {
  deliver(message: AccountEmailMessage): Promise<void>;
}

const developmentOutbox: AccountEmailMessage[] = [];

export class AccountEmailDeliveryUnavailableError extends Error {
  constructor() { super('Account email delivery is not configured'); this.name = 'AccountEmailDeliveryUnavailableError'; }
}

export function accountEmailDeliveryConfigured(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ACCOUNT_EMAIL_DELIVERY === 'memory';
}

/**
 * Safe default until a transactional-email provider is configured. Development and
 * integration tests may opt into a process-local outbox; production never records
 * or logs raw recovery tokens.
 */
export function accountEmailDelivery(): AccountEmailDelivery {
  if (accountEmailDeliveryConfigured()) {
    return {deliver: async message => { developmentOutbox.push(message); }};
  }
  return {deliver: async () => { throw new AccountEmailDeliveryUnavailableError(); }};
}

export function readDevelopmentAccountEmailOutbox(): readonly AccountEmailMessage[] {
  if (process.env.NODE_ENV === 'production') return [];
  return developmentOutbox;
}

export function clearDevelopmentAccountEmailOutbox(): void {
  if (process.env.NODE_ENV !== 'production') developmentOutbox.length = 0;
}
