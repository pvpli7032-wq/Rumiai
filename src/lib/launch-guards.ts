/**
 * Launch safety policy. Intentionally dependency-free so it can be tested before
 * installing the full Next.js/Prisma dependency tree.
 *
 * Production NEVER returns scripted demo replies or mints test currency.
 */
export type LaunchEnvironment = Record<string, string | undefined>;

export function mayUseMockChat(env: LaunchEnvironment): boolean {
  return env.NODE_ENV !== 'production' && env.DISABLE_MOCK_AI !== 'true';
}

export function isAiChatAvailable(env: LaunchEnvironment): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim()) || mayUseMockChat(env);
}

export function maySimulatePurchase(env: LaunchEnvironment): boolean {
  // Even an accidental production ALLOW_SIMULATED_PURCHASES=true cannot mint coins.
  return env.NODE_ENV !== 'production' && env.ALLOW_SIMULATED_PURCHASES === 'true';
}
