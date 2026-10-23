/**
 * Which models a reader may pick for a chat.
 *
 * The provider quota is shared by the whole platform and billed per provider per day,
 * so letting a request name any model would let one reader point everyone's budget at
 * the most expensive option. Selection is therefore limited to the chain the operator
 * configured, and anything else is rejected rather than silently ignored.
 *
 * Configure the primary and fallback models in the server environment.
 */

/** The configured primary followed by its fallbacks — the same list the chat route tries. */
export function allowedModels(): string[] {
  const primary = process.env.AI_MODEL || 'gpt-4o-mini';
  const fallbacks = (process.env.AI_FALLBACK_MODELS || '')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}
